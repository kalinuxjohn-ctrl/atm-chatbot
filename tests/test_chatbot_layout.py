from html.parser import HTMLParser
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


class Elements(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.tags = []
        self.feed(path.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attributes):
        self.tags.append((tag, dict(attributes)))


class ChatbotLayoutTests(unittest.TestCase):
    def test_main_app_pages_share_a_replaceable_favicon(self):
        pages = [
            *ROOT.joinpath("main-app/gateway/html").rglob("*.html"),
            *ROOT.joinpath("main-app/web").rglob("*.html"),
        ]
        for page in pages:
            with self.subTest(page=page.relative_to(ROOT)):
                icons = [attributes for tag, attributes in Elements(page).tags
                         if tag == "link" and attributes.get("rel") == "icon"]
                self.assertEqual(len(icons), 1)
                self.assertEqual(icons[0]["type"], "image/svg+xml")
                asset = ROOT / "main-app/gateway/html" / icons[0]["href"].lstrip("/")
                self.assertEqual(asset.name, "favicon.svg")
                self.assertEqual(ET.parse(asset).getroot().tag, "{http://www.w3.org/2000/svg}svg")

    def test_admin_can_create_interventions_without_technician_or_visit_dates(self):
        page = Elements(ROOT / "main-app/gateway/html/admin/index.html")
        self.assertTrue(any("data-intervention-create-toggle" in attributes for _, attributes in page.tags))
        self.assertTrue(any("data-admin-intervention-form" in attributes for _, attributes in page.tags))
        self.assertTrue(any("data-admin-add-symptom" in attributes for _, attributes in page.tags))
        form = (ROOT / "main-app/gateway/html/admin/js/adminInterventionForm.js").read_text(encoding="utf-8")
        self.assertIn("symptomRows.map", form)
        self.assertIn("interventionAddApi.create(body)", form)
        self.assertNotIn("technician_id:", form)
        self.assertNotIn("opened_at:", form)
        self.assertNotIn("closed_at:", form)
        gateway = (ROOT / "main-app/gateway/nginx.conf").read_text(encoding="utf-8")
        self.assertIn("proxy_set_header X-Authenticated-Admin-Username $authenticated_admin_username", gateway)

    def test_text_over_the_photo_uses_contrasting_panels_in_every_theme(self):
        styles = (ROOT / "main-app/gateway/html/shared/css/base.css").read_text(encoding="utf-8")
        admin_styles = (ROOT / "main-app/gateway/html/admin/css/administration.css").read_text(encoding="utf-8")
        self.assertIn("--color-content-glass: rgb(255 255 255 / 94%)", styles)
        self.assertIn("--color-content-glass: rgb(24 27 30 / 96%)", styles)
        self.assertIn("--color-content-glass: rgb(255 255 255 / 96%)", styles)
        self.assertIn("background: var(--color-content-glass)", admin_styles)
        self.assertIn(".page-heading,\n.home-hero {", styles)
        self.assertNotIn(':root[data-theme="gab"] :is(.home-hero, .page-heading) p', styles)
        admin = (ROOT / "main-app/gateway/html/admin/index.html").read_text(encoding="utf-8")
        self.assertIn("Pilotage de l'application", admin)

    def test_chat_has_no_sidebar_context_or_removed_actions(self):
        elements = Elements(ROOT / "frontend/public/atm-chatbot.html")
        self.assertFalse(any(tag in {"aside", "nav"} for tag, _ in elements.tags))
        ids = [attributes["id"] for _, attributes in elements.tags if "id" in attributes]
        self.assertEqual(len(ids), len(set(ids)))
        for removed_id in ("app-sidebar", "context-panel", "intervention-add-dialog", "logout-button"):
            self.assertNotIn(removed_id, ids)
        for required_id in ("technician-name", "technician-number", "message-input", "settings-dialog", "voice-dialog"):
            self.assertIn(required_id, ids)

    def test_theme_control_has_a_settings_slot(self):
        elements = Elements(ROOT / "frontend/public/atm-chatbot.html")
        slots = [attributes for _, attributes in elements.tags if "data-theme-settings" in attributes]
        self.assertEqual(len(slots), 1)

    def test_original_chat_settings_remain_available(self):
        elements = Elements(ROOT / "frontend/public/atm-chatbot.html")
        controls = {attributes.get("name") for tag, attributes in elements.tags if tag in {"input", "select"}}
        self.assertTrue({"voiceGender", "voiceURI", "voiceModeEnabled", "autoRead"} <= controls)
        self.assertTrue(any("data-avatar-choices" in attributes for _, attributes in elements.tags))
        self.assertTrue(any("data-voice-test" in attributes for _, attributes in elements.tags))

    def test_integrated_chatbot_keeps_the_full_welcome_screen(self):
        source = (ROOT / "frontend/public/js/pages/atm-chatbot.js").read_text(encoding="utf-8")
        self.assertNotIn("compactWelcome: true", source)
        chat_view = (ROOT / "frontend/public/js/components/chatView.js").read_text(encoding="utf-8")
        self.assertIn('message.classList.add("welcome-message")', chat_view)
        self.assertIn("message.prepend(createWelcomeReactor())", chat_view)

    def test_photo_background_is_available_across_the_app(self):
        frontend_asset = ROOT / "frontend/public/assets/images/technicienne-maintenance-atm-tpe.png"
        gateway_asset = ROOT / "main-app/gateway/html/shared/images/technicienne-maintenance-atm-tpe.png"
        chatbot_styles = (ROOT / "frontend/public/css/theme.css").read_text(encoding="utf-8")
        home_styles = (ROOT / "frontend/public/css/home.css").read_text(encoding="utf-8")
        gateway_styles = (ROOT / "main-app/gateway/html/shared/css/base.css").read_text(encoding="utf-8")

        self.assertTrue(frontend_asset.is_file())
        self.assertTrue(gateway_asset.is_file())
        self.assertIn('--app-background: url("../assets/images/technicienne-maintenance-atm-tpe.png") center / cover no-repeat fixed;', chatbot_styles)
        self.assertIn('--page-background-image: url("/shared/images/technicienne-maintenance-atm-tpe.png");', gateway_styles)
        self.assertNotIn("linear-gradient(90deg, rgb(var(--background-veil-rgb)", chatbot_styles)
        self.assertNotIn("linear-gradient(90deg, rgb(238 243 239", gateway_styles)
        self.assertIn("background-size: cover;", gateway_styles)
        self.assertIn("background-position: center top", home_styles)

    def test_login_places_the_form_opposite_the_background_technician(self):
        login_page = (ROOT / "main-app/web/auth/login.html").read_text(encoding="utf-8")
        auth_styles = (ROOT / "main-app/web/auth/css/auth.css").read_text(encoding="utf-8")
        gateway_styles = (ROOT / "main-app/gateway/html/shared/css/base.css").read_text(encoding="utf-8")
        photo = ROOT / "main-app/gateway/html/shared/images/technicienne-maintenance-atm-tpe.png"

        self.assertIn('class="login-page"', login_page)
        self.assertIn('data-login-form', login_page)
        self.assertTrue(photo.is_file())
        self.assertIn('url("/shared/images/technicienne-maintenance-atm-tpe.png")', gateway_styles)
        self.assertIn("grid-template-columns: minmax(320px, 440px) minmax(0, 1fr)", auth_styles)
        self.assertIn(".login-page .authentication-brand-panel", auth_styles)
        self.assertIn("background: rgb(255 255 255 / 58%)", auth_styles)
        self.assertIn("backdrop-filter: blur(20px) saturate(135%)", auth_styles)
        self.assertIn("background-size: cover;", gateway_styles)
        self.assertNotIn("linear-gradient(90deg, rgb(238 243 239", gateway_styles)

    def test_connected_sidebar_uses_glass_profile_and_confirms_logout(self):
        shell_script = (ROOT / "main-app/gateway/html/shared/js/connectedPageShell.js").read_text(encoding="utf-8")
        confirmation_dialog = (ROOT / "main-app/gateway/html/shared/js/confirmationDialog.js").read_text(encoding="utf-8")
        gateway_styles = (ROOT / "main-app/gateway/html/shared/css/base.css").read_text(encoding="utf-8")

        self.assertIn("createAvatar(currentUser.username)", shell_script)
        self.assertIn("app-sidebar-brand-role", shell_script)
        self.assertNotIn('createElementWithText("div", "app-sidebar-user")', shell_script)
        self.assertIn("Réduire le menu", shell_script)
        self.assertIn('import { confirmAction } from "./confirmationDialog.js"', shell_script)
        self.assertNotIn("window.confirm(", shell_script)
        self.assertNotIn("window.alert(", shell_script)
        self.assertIn('createElementWithText("dialog", "app-confirmation-dialog")', confirmation_dialog)
        self.assertIn('createElementWithText("button", "button button-secondary", cancelLabel)', confirmation_dialog)
        self.assertIn("--color-navigation-glass: rgb(255 255 255 / 88%)", gateway_styles)
        self.assertIn("backdrop-filter: blur(20px) saturate(135%)", gateway_styles)
        self.assertIn(".app-sidebar-footer .app-sidebar-logout", gateway_styles)
        self.assertIn("color: var(--sidebar-logout-color)", gateway_styles)
        self.assertIn("--sidebar-logout-color: #b45309", gateway_styles)
        self.assertIn("--sidebar-logout-color: #fb923c", gateway_styles)
        self.assertIn("background: var(--sidebar-background)", gateway_styles)
        self.assertIn("--sidebar-padding-top: 30px", gateway_styles)
        self.assertIn("padding: var(--sidebar-padding-top) 12px 16px", gateway_styles)

    def test_map_deletion_uses_the_same_yes_no_dialog(self):
        map_script = (ROOT / "main-app/web/map/js/mapPage.js").read_text(encoding="utf-8")

        self.assertIn('import { confirmAction } from "/shared/js/confirmationDialog.js"', map_script)
        self.assertIn('title: "Supprimer ce lieu ?"', map_script)
        self.assertIn('confirmLabel: "Oui, supprimer"', map_script)
        self.assertIn('cancelLabel: "Non"', map_script)
        self.assertNotIn("window.confirm(", map_script)

    def test_sidebar_has_chatbot_submenu_and_a_persistent_rotating_icon(self):
        styles = (ROOT / "main-app/gateway/html/shared/css/base.css").read_text(encoding="utf-8")
        shell_script = (ROOT / "main-app/gateway/html/shared/js/connectedPageShell.js").read_text(encoding="utf-8")

        self.assertIn("--dropdown-background: rgb(43 39 36 / 84%)", styles)
        self.assertIn("select:not([multiple])::picker(select)", styles)
        self.assertNotIn(':root[data-theme="gab"] select', styles)
        self.assertIn('createNavigationSection("Administration")', shell_script)
        self.assertIn('createNavigationSection("Fonctionnalités")', shell_script)
        self.assertIn('path: "/atm-chatbot/#new-conversation"', shell_script)
        self.assertIn('createElementWithText("details", "app-chatbot-menu")', shell_script)
        self.assertIn('path: "/atm-chatbot/#conversations"', shell_script)
        self.assertIn('label: "Voir les conversations"', shell_script)
        self.assertNotIn("toggleButton.replaceChildren", shell_script)
        self.assertIn('createIcon("collapseSidebar", "icon app-sidebar-toggle-icon")', shell_script)
        self.assertIn('.app-sidebar-toggle[aria-expanded="false"] .app-sidebar-toggle-icon', styles)
        self.assertIn("transition: transform 280ms ease", styles)
        self.assertIn("--sidebar-compact-footer-gap: 32px", styles)
        self.assertIn("prefers-reduced-motion: reduce", styles)

    def test_sidebar_spacing_and_home_chatbot_image_are_customizable(self):
        styles = (ROOT / "main-app/gateway/html/shared/css/base.css").read_text(encoding="utf-8")
        home = Elements(ROOT / "main-app/gateway/html/home.html")
        self.assertIn("--sidebar-item-gap: 12px", styles)
        self.assertIn("--sidebar-label-size: 1.067rem", styles)
        self.assertIn("--sidebar-option-icon-size: 22px", styles)
        self.assertIn("font-size: var(--sidebar-label-size)", styles)
        self.assertIn("width: var(--sidebar-option-icon-size)", styles)
        self.assertIn("gap: var(--sidebar-item-gap)", styles)
        self.assertIn("margin-top: var(--sidebar-footer-gap)", styles)
        self.assertIn("--sidebar-footer-gap: clamp(72px, 13vh, 130px)", styles)
        self.assertIn("--sidebar-footer-item-gap: 20px", styles)
        self.assertIn("padding-top: var(--sidebar-footer-padding-top)", styles)
        self.assertIn("flex: 0 1 auto", styles)
        self.assertTrue(any(tag == "img" and attributes.get("src") == "/shared/images/chatbot-assistant.svg"
                            for tag, attributes in home.tags))
        self.assertTrue((ROOT / "main-app/gateway/html/shared/images/chatbot-assistant.svg").is_file())
        for image in ("map-route.svg", "messaging-bubbles.svg", "phone-call.svg"):
            self.assertTrue(any(tag == "img" and attributes.get("src") == f"/shared/images/{image}"
                                for tag, attributes in home.tags))
            self.assertTrue((ROOT / f"main-app/gateway/html/shared/images/{image}").is_file())

    def test_admin_sections_have_no_separate_navigation(self):
        elements = Elements(ROOT / "main-app/gateway/html/admin/index.html")
        self.assertFalse(any(tag == "nav" for tag, _ in elements.tags))
        sections = {attributes["data-section"] for _, attributes in elements.tags if "data-section" in attributes}
        self.assertEqual(sections, {"comptes", "propositions", "interventions", "codes-erreur", "pannes-frequentes"})
        self.assertTrue(any("data-page-shell" in attributes for _, attributes in elements.tags))

    def test_route_menu_offers_all_modes_and_preferences(self):
        elements = Elements(ROOT / "main-app/web/map/index.html")
        values = {attributes.get("value") for tag, attributes in elements.tags if tag == "option"}
        self.assertTrue({"walking", "cycling", "motorcycle", "driving", "shortest", "fastest"} <= values)
        self.assertTrue(any("data-route-pick-start" in attributes for _, attributes in elements.tags))


if __name__ == "__main__":
    unittest.main()
