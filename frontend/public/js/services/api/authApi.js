/**
 * API de connexion du technicien.
 *
 * ⏳ MOCK : le backend n'expose AUCUNE route d'authentification.
 * POST /chat attend seulement un `technician_id` existant en base
 * (7 ou 8 avec les données de démo).
 *
 * TODO: brancher sur la future API d'authentification (ex. POST /auth/login)
 *       et lire le technician_id dans sa réponse.
 */

import { ApiRequestError } from "../../core/httpClient.js";
import { mockLoginResponse } from "./mocks.js";

/**
 * @returns {Promise<{technicianId: number, displayName: string}>}
 */
export async function login({ technicianId, displayName }) {
  if (!Number.isInteger(technicianId) || technicianId <= 0) {
    throw new ApiRequestError("Identifiant technicien invalide.", { kind: "request" });
  }

  const name = displayName.trim() || `Technicien ${technicianId}`;
  const payload = await mockLoginResponse({ technicianId, displayName: name });
  return { technicianId: payload.technician_id, displayName: payload.display_name };
}
