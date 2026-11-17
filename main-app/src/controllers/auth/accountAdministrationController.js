/**
 * Administration des comptes (rôle admin uniquement, vérifié par la route).
 */

import { parseWithSchema } from "../../core/validation.js";
import {
  accountCreationRequestSchema,
  activeStateChangeRequestSchema,
  passwordResetRequestSchema,
  roleChangeRequestSchema,
  technicianIdParametersSchema,
} from "../../schemas/auth/authSchemas.js";
import {
  changeAccountActiveState,
  changeAccountRole,
  createAccount,
  findAccount,
  listAccounts,
  resetAccountPassword,
} from "../../services/auth/accountAdministrationService.js";

export async function listAllAccounts(request, response) {
  response.json({ accounts: await listAccounts() });
}

export async function createNewAccount(request, response) {
  const accountRequest = parseWithSchema(accountCreationRequestSchema, request.body);
  const technicianId = await createAccount(accountRequest);
  response.status(201).json({ account: await findAccount(technicianId) });
}

export async function updateRoleOfAccount(request, response) {
  const { technicianId } = parseWithSchema(technicianIdParametersSchema, request.params);
  const { role } = parseWithSchema(roleChangeRequestSchema, request.body);
  response.json({ account: await changeAccountRole(request.user, technicianId, role) });
}

export async function updateActiveStateOfAccount(request, response) {
  const { technicianId } = parseWithSchema(technicianIdParametersSchema, request.params);
  const { isActive } = parseWithSchema(activeStateChangeRequestSchema, request.body);
  response.json({ account: await changeAccountActiveState(request.user, technicianId, isActive) });
}

export async function resetPasswordOfAccount(request, response) {
  const { technicianId } = parseWithSchema(technicianIdParametersSchema, request.params);
  const { newPassword } = parseWithSchema(passwordResetRequestSchema, request.body);
  await resetAccountPassword(request.user, technicianId, newPassword);
  response.status(204).end();
}
