/**
 * Routes /api/messaging/... : URL -> middlewares -> controller, rien d'autre.
 * Toutes exigent une session ; la participation à la conversation est
 * vérifiée par le service à chaque requête.
 */

import { Router } from "express";

import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { requireAuthenticatedUser } from "../../middlewares/requireAuthenticatedUser.js";
import {
  downloadAttachment,
  listConversations,
  listMessages,
  markAsRead,
  notificationState,
  openConversation,
  postAttachmentMessage,
  postTextMessage,
  searchContacts,
} from "../../controllers/messaging/messagingController.js";

export function createMessagingRouter() {
  const messagingRouter = Router();
  messagingRouter.use(requireAuthenticatedUser);

  messagingRouter.get("/contacts", asyncHandler(searchContacts));
  messagingRouter.get("/notifications", asyncHandler(notificationState));
  messagingRouter.get("/conversations", asyncHandler(listConversations));
  messagingRouter.post("/conversations", asyncHandler(openConversation));
  messagingRouter.get("/conversations/:conversationId/messages", asyncHandler(listMessages));
  messagingRouter.post("/conversations/:conversationId/messages", asyncHandler(postTextMessage));
  messagingRouter.post("/conversations/:conversationId/attachments", asyncHandler(postAttachmentMessage));
  messagingRouter.post("/conversations/:conversationId/read", asyncHandler(markAsRead));
  messagingRouter.get("/attachments/:attachmentId", asyncHandler(downloadAttachment));

  return messagingRouter;
}
