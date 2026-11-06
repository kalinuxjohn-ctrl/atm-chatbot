import { findSafeLoginRedirectPath } from "../../../gateway/html/shared/js/apiClient.js";

const ORIGIN = "http://localhost:8080";

describe("retour après connexion", () => {
  test.each(["technician", "moderator", undefined])("le rôle %s ne retourne pas dans l'administration", (role) => {
    for (const path of [
      "/admin", "/admin/", "/admin/#comptes", "/admin/index.html",
      "/admin/js/administrationPage.js", "/auth/accounts.html",
      "/atm-chatbot/app/admin.html", "/atm-chatbot/app/api/admin/proposals",
      "/map/../admin/", "/%61dmin/", "/%2e/admin/",
    ]) {
      expect(findSafeLoginRedirectPath(path, role, ORIGIN)).toBe("/");
    }
  });

  test("un administrateur conserve sa rubrique", () => {
    expect(findSafeLoginRedirectPath("/admin/#comptes", "admin", ORIGIN)).toBe("/admin/#comptes");
  });

  test.each(["/", "/map/", "/messaging/?conversation=12", "/calls/#directory", "/atm-chatbot/"])(
    "un technicien conserve la destination autorisée %s", (path) => {
      expect(findSafeLoginRedirectPath(path, "technician", ORIGIN)).toBe(path);
    },
  );

  test.each([null, "", "https://other.test", "//other.test", "/\\other.test", "/\n/other.test", "/%invalid"])(
    "une destination invalide ou externe %s renvoie à l'accueil", (path) => {
      expect(findSafeLoginRedirectPath(path, "admin", ORIGIN)).toBe("/");
    },
  );
});
