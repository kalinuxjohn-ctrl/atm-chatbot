/**
 * API d'administration des réponses enregistrées du Copilote.
 * ✅ API RÉELLE, protégée par la clé ADMIN_API_KEY (en-tête X-Admin-Key) :
 *   GET|POST       /api/admin/error_code          { code, label?, device_type?, reply? }
 *   PUT|DELETE     /api/admin/error_code/{id}
 *   GET|POST       /api/admin/usual_problem       { device_type, label, reply, display_order? }
 *   PUT|DELETE     /api/admin/usual_problem/{id}
 *
 * Les enregistrements sont renvoyés tels que le backend les décrit (snake_case).
 */

import { ApiRequestError, deleteJson, getJson, postJson, putJson } from "../../core/httpClient.js";

const adminHeaders = (adminKey) => ({ "X-Admin-Key": adminKey });

/** Un client CRUD par ressource : les deux ressources ont exactement les mêmes routes. */
function createAdminResource(resourcePath) {
  return {
    async list({ adminKey }) {
      const payload = await getJson(resourcePath, { headers: adminHeaders(adminKey) });
      if (!Array.isArray(payload)) throw new ApiRequestError("Liste invalide.", { kind: "invalid-response" });
      return payload;
    },
    create({ adminKey, record }) {
      return postJson(resourcePath, record, { headers: adminHeaders(adminKey) });
    },
    update({ adminKey, id, record }) {
      return putJson(`${resourcePath}/${encodeURIComponent(id)}`, record, { headers: adminHeaders(adminKey) });
    },
    remove({ adminKey, id }) {
      return deleteJson(`${resourcePath}/${encodeURIComponent(id)}`, { headers: adminHeaders(adminKey) });
    },
  };
}

export const adminErrorCodes = createAdminResource("/admin/error_code");
export const adminUsualProblems = createAdminResource("/admin/usual_problem");
