/**
 * Messagerie : appartenance aux conversations, texte brut (anti-XSS),
 * polling par curseur, et contrôle des pièces jointes.
 */

import fs from "node:fs";

import sharp from "sharp";

import { loadConfiguration } from "../../../src/core/config.js";
import { createFeatureApp } from "../../../src/core/createFeatureApp.js";
import { createMessagingRouter } from "../../../src/routes/messaging/messagingRoutes.js";
import { connectToTestDatabase, createAccountWithSession, describeWithDatabase, sendAs } from "../integrationTestHelpers.js";

// En-tête EBML minimal d'un fichier WebM (ce que produit MediaRecorder dans Chrome).
const MINIMAL_WEBM_HEADER = Buffer.from(
  "1A45DFA39F4286810142F7810142F2810442F381084282847765626D4287810442858102",
  "hex",
);

function createMessagingApp() {
  const configuration = loadConfiguration("messaging");
  fs.mkdirSync(configuration.MAIN_APP_UPLOADS_DIRECTORY, { recursive: true });
  return createFeatureApp({ featureName: "messaging", configuration, apiRouter: createMessagingRouter() });
}

async function openConversationBetween(messagingApp, firstAccount, secondAccount) {
  const openingResponse = await sendAs(messagingApp, firstAccount)
    .post("/api/messaging/conversations")
    .send({ participantTechnicianId: secondAccount.technicianId });
  expect([200, 201]).toContain(openingResponse.status);
  return openingResponse.body.conversationId;
}

describeWithDatabase("messagerie", () => {
  connectToTestDatabase();
  const messagingApp = createMessagingApp();

  test("une conversation directe est unique entre deux personnes", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const firstConversationId = await openConversationBetween(messagingApp, alan, bob);
    const secondConversationId = await openConversationBetween(messagingApp, bob, alan);
    expect(secondConversationId).toBe(firstConversationId);

    const withSelf = await sendAs(messagingApp, alan).post("/api/messaging/conversations").send({ participantTechnicianId: alan.technicianId });
    expect(withSelf.status).toBe(422);
    const withNobody = await sendAs(messagingApp, alan).post("/api/messaging/conversations").send({ participantTechnicianId: 2_000_000_000 });
    expect(withNobody.status).toBe(404);
  });

  test("un non-participant ne peut ni lire, ni écrire, ni marquer comme lu (404)", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const intruder = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);

    expect((await sendAs(messagingApp, intruder).get(`/api/messaging/conversations/${conversationId}/messages`)).status).toBe(404);
    expect((await sendAs(messagingApp, intruder).post(`/api/messaging/conversations/${conversationId}/messages`).send({ text: "Coucou" })).status).toBe(404);
    expect((await sendAs(messagingApp, intruder).post(`/api/messaging/conversations/${conversationId}/read`).send({ lastReadMessageId: 1 })).status).toBe(404);
    const intruderUpload = await sendAs(messagingApp, intruder)
      .post(`/api/messaging/conversations/${conversationId}/attachments`)
      .attach("file", MINIMAL_WEBM_HEADER, "voice.webm");
    expect(intruderUpload.status).toBe(404);
    expect((await sendAs(messagingApp, null).get(`/api/messaging/conversations/${conversationId}/messages`)).status).toBe(401);
  });

  test("le texte est gardé tel quel (balises, emojis) et les contrôles invisibles sont refusés", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);
    const rawText = "<script>alert('xss')</script>\nGAB réparé 👍🏽 ✅ ça marche";

    const sendResponse = await sendAs(messagingApp, alan).post(`/api/messaging/conversations/${conversationId}/messages`).send({ text: rawText });
    expect(sendResponse.status).toBe(201);
    expect(sendResponse.body.message.text).toBe(rawText);
    expect(sendResponse.body.message.isOwnMessage).toBe(true);

    const bobView = await sendAs(messagingApp, bob).get(`/api/messaging/conversations/${conversationId}/messages`);
    expect(bobView.body.messages.at(-1)).toMatchObject({ text: rawText, isOwnMessage: false });

    const invalidTexts = ["", "   ", "son\u0007", "texte ‮retourné", "x".repeat(2001)];
    for (const invalidText of invalidTexts) {
      const invalidResponse = await sendAs(messagingApp, alan).post(`/api/messaging/conversations/${conversationId}/messages`).send({ text: invalidText });
      expect(invalidResponse.status).toBe(422);
    }
    // 2000 emojis = 2000 caractères affichés : accepté (comptés en caractères, pas en octets).
    const emojiResponse = await sendAs(messagingApp, alan).post(`/api/messaging/conversations/${conversationId}/messages`).send({ text: "😀".repeat(2000) });
    expect(emojiResponse.status).toBe(201);
  });

  test("polling : ?after= ne renvoie que les nouveaux messages ; compteur de non lus", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);
    const first = await sendAs(messagingApp, alan).post(`/api/messaging/conversations/${conversationId}/messages`).send({ text: "Un" });
    await sendAs(messagingApp, alan).post(`/api/messaging/conversations/${conversationId}/messages`).send({ text: "Deux" });

    const newerMessages = await sendAs(messagingApp, bob).get(`/api/messaging/conversations/${conversationId}/messages?after=${first.body.message.id}`);
    expect(newerMessages.body.messages.map((message) => message.text)).toEqual(["Deux"]);

    const bobConversations = await sendAs(messagingApp, bob).get("/api/messaging/conversations");
    const listed = bobConversations.body.conversations.find((conversation) => conversation.id === conversationId);
    expect(listed.unreadMessageCount).toBe(2);
    expect(listed.otherParticipant.username).toBe(alan.username);

    const lastMessageId = newerMessages.body.messages.at(-1).id;
    await sendAs(messagingApp, bob).post(`/api/messaging/conversations/${conversationId}/read`).send({ lastReadMessageId: lastMessageId });
    const afterReading = await sendAs(messagingApp, bob).get("/api/messaging/conversations");
    expect(afterReading.body.conversations.find((conversation) => conversation.id === conversationId).unreadMessageCount).toBe(0);
  });

  test("notifications : état durable par participant, sans contenu, accusés bornés à la conversation", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const outsider = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);
    const unrelatedId = await openConversationBetween(messagingApp, alan, outsider);
    const post = (id, account, text) => sendAs(messagingApp, account).post(`/api/messaging/conversations/${id}/messages`).send({ text });
    const first = (await post(conversationId, alan, "Fixture un")).body.message.id;
    const second = (await post(conversationId, alan, "Fixture deux")).body.message.id;
    const unrelated = (await post(unrelatedId, alan, "Autre fixture")).body.message.id;
    const own = (await post(conversationId, bob, "Réponse fixture")).body.message.id;
    const state = async (account) => (await sendAs(messagingApp, account).get("/api/messaging/notifications")).body.conversations;
    expect(await state(bob)).toEqual([{ conversationId, unreadCount: 2, latestIncomingMessageId: second }]);
    expect(await state(outsider)).toEqual([{ conversationId: unrelatedId, unreadCount: 1, latestIncomingMessageId: unrelated }]);
    expect((await state(alan)).find((item) => item.conversationId === conversationId))
      .toEqual({ conversationId, unreadCount: 1, latestIncomingMessageId: own });
    expect((await sendAs(messagingApp, null).get("/api/messaging/notifications")).status).toBe(401);
    for (const invalidId of [unrelated, 2_000_000_000]) {
      expect((await sendAs(messagingApp, bob).post(`/api/messaging/conversations/${conversationId}/read`)
        .send({ lastReadMessageId: invalidId })).status).toBe(404);
    }
    expect((await state(bob))[0].unreadCount).toBe(2);
    expect((await sendAs(messagingApp, bob).post(`/api/messaging/conversations/${conversationId}/read`)
      .send({ lastReadMessageId: second })).status).toBe(204);
    await sendAs(messagingApp, bob).post(`/api/messaging/conversations/${conversationId}/read`).send({ lastReadMessageId: first });
    expect((await state(bob))[0].unreadCount).toBe(0);
    const third = (await post(conversationId, alan, "Fixture trois")).body.message.id;
    expect((await state(bob))[0]).toEqual({ conversationId, unreadCount: 1, latestIncomingMessageId: third });
  });
});

describeWithDatabase("pièces jointes", () => {
  connectToTestDatabase();
  const messagingApp = createMessagingApp();

  test("image : acceptée, ré-encodée sans métadonnées EXIF, servie avec nosniff + CSP sandbox", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const intruder = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);
    const photoWithExif = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3366cc" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "position secrète", Artist: "Alan" } })
      .toBuffer();
    expect((await sharp(photoWithExif).metadata()).exif).toBeDefined();

    const uploadResponse = await sendAs(messagingApp, alan)
      .post(`/api/messaging/conversations/${conversationId}/attachments`)
      .field("caption", "Écran du GAB 📷")
      .attach("file", photoWithExif, { filename: "../../etc/passwd.jpg", contentType: "application/x-php" });
    expect(uploadResponse.status).toBe(201);
    const { attachment, kind, text } = uploadResponse.body.message;
    expect(kind).toBe("image");
    expect(text).toBe("Écran du GAB 📷");
    expect(attachment.mediaType).toBe("image/jpeg");

    const downloadResponse = await sendAs(messagingApp, bob).get(attachment.url).buffer(true);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers["content-type"]).toBe("image/jpeg");
    expect(downloadResponse.headers["x-content-type-options"]).toBe("nosniff");
    expect(downloadResponse.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect((await sharp(downloadResponse.body).metadata()).exif).toBeUndefined();

    expect((await sendAs(messagingApp, intruder).get(attachment.url)).status).toBe(404);
  });

  test("audio WebM (MediaRecorder) : accepté comme message vocal", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);
    const uploadResponse = await sendAs(messagingApp, alan)
      .post(`/api/messaging/conversations/${conversationId}/attachments`)
      .attach("file", MINIMAL_WEBM_HEADER, { filename: "voice.webm", contentType: "audio/webm" });
    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.message.kind).toBe("audio");
    expect(uploadResponse.body.message.attachment.mediaType).toBe("audio/webm");
  });

  test("le vrai type compte : SVG, HTML déguisé en PNG et fichier vide sont refusés", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);
    const refusedFiles = [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image.svg", "image/svg+xml"],
      [Buffer.from("<html><script>alert(1)</script></html>"), "photo.png", "image/png"],
      [Buffer.from("MZ\x90\x00 pas une image"), "photo.jpg", "image/jpeg"],
    ];
    for (const [fileBytes, filename, contentType] of refusedFiles) {
      const refusedResponse = await sendAs(messagingApp, alan)
        .post(`/api/messaging/conversations/${conversationId}/attachments`)
        .attach("file", fileBytes, { filename, contentType });
      expect(refusedResponse.status).toBe(422);
    }
    const withoutFile = await sendAs(messagingApp, alan).post(`/api/messaging/conversations/${conversationId}/attachments`).field("caption", "rien");
    expect(withoutFile.status).toBe(422);
  });

  test("fichier trop volumineux : 413 ; deux fichiers à la fois : 422", async () => {
    const alan = await createAccountWithSession();
    const bob = await createAccountWithSession();
    const conversationId = await openConversationBetween(messagingApp, alan, bob);
    // MAIN_APP_UPLOAD_MAX_BYTES = 2 Mo dans les tests.
    const oversizedFile = Buffer.concat([MINIMAL_WEBM_HEADER, Buffer.alloc(3 * 1024 * 1024)]);
    const oversizedResponse = await sendAs(messagingApp, alan)
      .post(`/api/messaging/conversations/${conversationId}/attachments`)
      .attach("file", oversizedFile, "big.webm");
    expect(oversizedResponse.status).toBe(413);

    const twoFilesResponse = await sendAs(messagingApp, alan)
      .post(`/api/messaging/conversations/${conversationId}/attachments`)
      .attach("file", MINIMAL_WEBM_HEADER, "one.webm")
      .attach("file", MINIMAL_WEBM_HEADER, "two.webm");
    expect(twoFilesResponse.status).toBe(422);
  });
});
