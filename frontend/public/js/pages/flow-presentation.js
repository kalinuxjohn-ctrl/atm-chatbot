const journeys = {
  login: {
    title: "Un badge préparé à l’accueil",
    kicker: "PARCOURS 1 · CONNEXION",
    status: "Prêt à présenter",
    truth: "Ici, la connexion est simulée : aucun mot de passe ni compte n’est vérifié côté serveur.",
    nodes: [
      {
        icon: "🧑‍🔧",
        name: "Technicien",
        detail: "saisit son numéro",
        title: "Vous vous présentez",
        simple: "Vous donnez votre numéro de technicien et, si vous le souhaitez, un nom à afficher.",
        technical: "Le formulaire #login-form recueille technicianId et displayName dans frontend/public/index.html.",
      },
      {
        icon: "🖥️",
        name: "Formulaire",
        detail: "contrôle le format",
        title: "Le navigateur vérifie le numéro",
        simple: "L’application vérifie que le numéro est un entier positif et enlève les espaces autour du nom.",
        technical: "login() dans frontend/public/js/services/api/authApi.js utilise Number.isInteger() et displayName.trim().",
      },
      {
        icon: "🎭",
        name: "Connexion simulée",
        detail: "pas d’appel serveur",
        title: "La connexion est jouée, pas vérifiée",
        simple: "Le navigateur fabrique une réponse de démonstration : aucune demande d’authentification ne part au serveur.",
        technical: "authApi.js appelle mockLoginResponse() dans frontend/public/js/services/api/mocks.js ; pas de route /auth/login.",
      },
      {
        icon: "🎟️",
        name: "Badge local",
        detail: "gardé dans le navigateur",
        title: "Le navigateur garde le badge",
        simple: "Le nom et le numéro sont gardés dans ce navigateur pour reconnaître la session de l’interface.",
        technical: "sessionService.login() enregistre l’objet retourné dans localStorage sous la clé copilot.session.",
      },
      {
        icon: "🚪",
        name: "Copilote",
        detail: "accès à l’interface",
        title: "Le Copilote s’ouvre",
        simple: "L’interface accepte cette session locale et vous emmène vers l’écran du Copilote.",
        technical: "home.js appelle login(), ferme le dialogue, puis navigue vers /copilot.html ; requireSession() lit la session locale.",
      },
    ],
  },
  message: {
    title: "Votre message part au bon guichet",
    kicker: "PARCOURS 2 · MESSAGE AU COPILOTE",
    status: "Prêt à présenter",
    truth: "Le numéro technicien relie la conversation à un technicien ; dans ce flux, il ne prouve pas son identité.",
    nodes: [
      {
        icon: "🧑‍🔧",
        name: "Technicien",
        detail: "décrit le problème",
        title: "Vous décrivez le symptôme",
        simple: "Vous écrivez ce que vous observez sur votre GAB ou TPE.",
        technical: "La zone de saisie et son écouteur submit sont gérés dans frontend/public/js/pages/copilot.js.",
      },
      {
        icon: "🧹",
        name: "Nettoyage",
        detail: "retire les espaces",
        title: "Le texte est préparé",
        simple: "Les espaces avant et après le message sont retirés ; un message vide n’est pas envoyé.",
        technical: "copilot.js appelle input.value.trim(), puis conversation.ask() dans frontend/public/js/services/conversationService.js.",
      },
      {
        icon: "📨",
        name: "Envoi JSON",
        detail: "via le proxy frontend",
        title: "Le message traverse la porte",
        simple: "Le navigateur envoie le texte, le numéro technicien et l’identifiant de conversation.",
        technical: "sendMessage() dans frontend/public/js/services/api/chatApi.js construit le POST /api/chat ; httpClient.js sérialise le JSON.",
      },
      {
        icon: "🏢",
        name: "Backend",
        detail: "valide et comprend",
        kind: "server",
        title: "Le serveur traite la demande",
        simple: "Le serveur vérifie la forme de la demande, charge la conversation et cherche quoi répondre.",
        technical: "ChatRequest (Pydantic), la route chat() puis handle_chat_message() valident et orchestrent le traitement.",
      },
      {
        icon: "🗄️",
        name: "Base de données",
        detail: "garde les échanges",
        kind: "database",
        title: "Le registre garde une trace",
        simple: "Le message, la réponse et le contexte de la conversation sont enregistrés.",
        technical: "conversation_service sauvegarde les messages ; chat_orchestrator_service sauvegarde le contexte et fait db.commit().",
      },
      {
        icon: "💬",
        name: "Réponse",
        detail: "revient à l’écran",
        title: "La réponse revient vers vous",
        simple: "Le Copilote renvoie sa réponse et l’affiche dans le fil de discussion.",
        technical: "FastAPI renvoie conversation_id et reply ; conversationService ajoute la réponse, puis copilot.js l’affiche.",
      },
    ],
  },
};

const track = document.querySelector("#flow-track");
const tabs = [...document.querySelectorAll("button[data-journey]")];
const counter = document.querySelector("#journey-counter");
const kicker = document.querySelector("#journey-kicker");
const title = document.querySelector("#journey-title");
const status = document.querySelector("#journey-status");
const explanation = document.querySelector(".explanation");
const explanationIcon = document.querySelector("#explanation-icon");
const stepLabel = document.querySelector("#step-label");
const stepTitle = document.querySelector("#step-title");
const simpleExplanation = document.querySelector("#simple-explanation");
const technicalExplanation = document.querySelector("#technical-explanation");
const truthNote = document.querySelector("#truth-note");
const previousButton = document.querySelector("#previous-button");
const playButton = document.querySelector("#play-button");
const nextButton = document.querySelector("#next-button");

let journeyName = "login";
let activeStep = 0;
let timer = null;

function stopAnimation() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  status.classList.remove("is-running");
  status.lastChild.textContent = " " + journeys[journeyName].status;
  playButton.innerHTML = '<span aria-hidden="true">▶</span> <span>Animer le parcours</span>';
}

function render() {
  const journey = journeys[journeyName];
  const step = journey.nodes[activeStep];

  track.dataset.journey = journeyName;
  track.replaceChildren();
  journey.nodes.forEach((node, index) => {
    const card = document.createElement("article");
    card.className = "flow-node";
    card.dataset.step = String(index);
    if (node.kind) card.dataset.kind = node.kind;
    card.setAttribute("aria-label", `Étape ${index + 1} : ${node.name}, ${node.detail}`);
    card.innerHTML = `
      <span class="node-icon" aria-hidden="true">${node.icon}</span>
      <span class="node-name"></span>
      <span class="node-detail"></span>
    `;
    card.querySelector(".node-name").textContent = node.name;
    card.querySelector(".node-detail").textContent = node.detail;
    if (index < journey.nodes.length - 1) {
      const link = document.createElement("span");
      link.className = "flow-link";
      link.dataset.link = String(index);
      link.setAttribute("aria-hidden", "true");
      link.append(document.createElement("span"));
      track.append(card, link);
    } else {
      track.append(card);
    }
  });

  const currentNodes = [...track.querySelectorAll(".flow-node")];
  const currentLinks = [...track.querySelectorAll(".flow-link")];
  currentNodes.forEach((node, index) => {
    node.classList.toggle("is-active", index === activeStep);
    node.classList.toggle("is-complete", index < activeStep);
  });
  currentLinks.forEach((link, index) => {
    link.classList.toggle("is-complete", index < activeStep);
    link.classList.toggle("is-active", index === activeStep && timer !== null);
  });

  tabs.forEach((tab) => {
    const selected = tab.dataset.journey === journeyName;
    tab.classList.toggle("is-selected", selected);
    tab.setAttribute("aria-pressed", String(selected));
  });

  counter.textContent = `Étape ${activeStep + 1} sur ${journey.nodes.length}`;
  kicker.textContent = journey.kicker;
  title.textContent = journey.title;
  truthNote.lastChild.textContent = " " + journey.truth;
  explanationIcon.textContent = step.icon;
  stepLabel.textContent = `ÉTAPE ${activeStep + 1}`;
  stepTitle.textContent = step.title;
  simpleExplanation.textContent = step.simple;
  technicalExplanation.textContent = step.technical;
  previousButton.disabled = activeStep === 0;
  nextButton.disabled = activeStep === journey.nodes.length - 1;

  explanation.classList.remove("step-in");
  void explanation.offsetWidth;
  explanation.classList.add("step-in");
  currentNodes[activeStep].scrollIntoView({
    block: "nearest",
    inline: "center",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

function advance() {
  if (activeStep >= journeys[journeyName].nodes.length - 1) {
    stopAnimation();
    render();
    return;
  }
  activeStep += 1;
  render();
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    stopAnimation();
    journeyName = tab.dataset.journey;
    activeStep = 0;
    render();
  });
});

previousButton.addEventListener("click", () => {
  stopAnimation();
  activeStep = Math.max(0, activeStep - 1);
  render();
});

nextButton.addEventListener("click", () => {
  stopAnimation();
  advance();
});

playButton.addEventListener("click", () => {
  if (timer !== null) {
    stopAnimation();
    render();
    return;
  }
  if (activeStep === journeys[journeyName].nodes.length - 1) activeStep = 0;
  status.classList.add("is-running");
  status.lastChild.textContent = " Animation en cours";
  playButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> <span>Mettre en pause</span>';
  render();
  timer = window.setInterval(advance, 1900);
  render();
});

render();
