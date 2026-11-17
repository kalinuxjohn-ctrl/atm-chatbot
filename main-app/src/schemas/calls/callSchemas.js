/**
 * Messages JSON du WebSocket de signalisation, validés un par un.
 *
 * Le serveur ne lit JAMAIS le contenu des offres SDP et candidats ICE : il
 * vérifie seulement leur forme et leur taille, puis les relaie à l'autre
 * participant de l'appel (et à lui seul).
 */

import { z } from "zod";

const callIdSchema = z.uuid();

// Une offre SDP audio fait quelques Ko ; 20 000 caractères laissent de la marge sans permettre d'abus.
const sessionDescriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1).max(20_000),
});

const iceCandidateSchema = z.object({
  candidate: z.string().max(2_000),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

export const clientSignalingMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("call.start"), calleeTechnicianId: z.number().int().positive() }),
  z.object({ type: z.literal("call.accept"), callId: callIdSchema }),
  z.object({ type: z.literal("call.decline"), callId: callIdSchema }),
  z.object({ type: z.literal("call.hang-up"), callId: callIdSchema }),
  z.object({ type: z.literal("call.offer"), callId: callIdSchema, sessionDescription: sessionDescriptionSchema }),
  z.object({ type: z.literal("call.answer"), callId: callIdSchema, sessionDescription: sessionDescriptionSchema }),
  z.object({ type: z.literal("call.ice-candidate"), callId: callIdSchema, iceCandidate: iceCandidateSchema }),
]);

export const callHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
