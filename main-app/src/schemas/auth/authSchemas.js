/**
 * Validation des entrées de la fonctionnalité auth (zod).
 * Les mêmes règles sont vérifiées en base (contrainte accounts_username_format).
 */

import { z } from "zod";

export const ACCOUNT_ROLES = ["technician", "moderator", "admin"];

export const usernameSchema = z
  .string({ error: "obligatoire" })
  .trim()
  .regex(/^[a-zA-Z0-9_.-]{3,30}$/, "3 à 30 caractères : lettres sans accent, chiffres, _ . -");

// 10 caractères minimum ; 128 maximum pour borner le coût du hachage argon2
// (un mot de passe de plusieurs Mo ferait travailler le serveur pour rien).
export const newPasswordSchema = z
  .string({ error: "obligatoire" })
  .min(10, "10 caractères minimum")
  .max(128, "128 caractères maximum");

// Mot de passe SAISI à la connexion : on ne révèle pas les règles, on borne juste la taille.
const typedPasswordSchema = z.string({ error: "obligatoire" }).min(1, "obligatoire").max(128, "128 caractères maximum");

const fullNameSchema = z.string().trim().min(1).max(200);

export const loginRequestSchema = z.object({
  username: z.string({ error: "obligatoire" }).trim().min(1, "obligatoire").max(30, "30 caractères maximum"),
  password: typedPasswordSchema,
});

export const registrationRequestSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
  fullName: fullNameSchema.optional(),
});

export const passwordChangeRequestSchema = z.object({
  currentPassword: typedPasswordSchema,
  newPassword: newPasswordSchema,
});

/**
 * Création d'un compte par un administrateur : soit rattaché à un technicien
 * du chatbot qui existe déjà (existingTechnicianId), soit avec un nouveau
 * technicien minimal (fullName obligatoire, la seule colonne requise de technician).
 */
export const accountCreationRequestSchema = z
  .object({
    username: usernameSchema,
    password: newPasswordSchema,
    role: z.enum(ACCOUNT_ROLES).default("technician"),
    existingTechnicianId: z.number().int().positive().optional(),
    fullName: fullNameSchema.optional(),
  })
  .refine((request) => request.existingTechnicianId !== undefined || request.fullName !== undefined, {
    message: "Indiquez un technicien existant (existingTechnicianId) ou un nom complet (fullName).",
    path: ["fullName"],
  });

export const technicianIdParametersSchema = z.object({
  technicianId: z.coerce.number().int().positive(),
});

export const roleChangeRequestSchema = z.object({ role: z.enum(ACCOUNT_ROLES) });

export const activeStateChangeRequestSchema = z.object({ isActive: z.boolean() });

export const passwordResetRequestSchema = z.object({ newPassword: newPasswordSchema });
