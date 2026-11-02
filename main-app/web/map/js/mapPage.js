/**
 * Page Carte : Leaflet pour l'interaction (marqueurs, bulles, clics),
 * MapLibre GL pour dessiner le fond de carte.
 *
 * Le fond de carte vient de /api/map/tiles/{z}/{x}/{y} : un relais de NOTRE
 * serveur (aucune clé d'API ni hôte externe dans le navigateur).
 * Les titres et descriptions sont saisis par des utilisateurs : ils sont
 * insérés avec textContent, jamais innerHTML (anti-XSS).
 */

import * as maplibreModule from "/map/vendor/maplibre-gl/maplibre-gl.mjs";
import { requestJson } from "/shared/js/apiClient.js";
import "/shared/js/connectedPageShell.js";
import { createButton, createElementWithText, formatDateTime } from "/shared/js/domHelpers.js";
import { createIcon } from "/shared/js/icons.js";

// Le pont Leaflet <-> MapLibre (script UMD) attend MapLibre en variable globale.
globalThis.maplibregl = maplibreModule.default ?? maplibreModule;
await import("/map/vendor/maplibre-gl-leaflet/leaflet-maplibre-gl.js");

const CATEGORY_LABELS = {
  atm_site: "Site de GAB",
  tpe_client: "Client TPE",
  parts_depot: "Dépôt de pièces",
  difficult_access: "Accès difficile",
  other: "Autre",
};
// Icône dessinée dans l'épingle de chaque catégorie (voir /shared/js/icons.js).
const CATEGORY_ICON_NAMES = {
  atm_site: "creditCard",
  tpe_client: "store",
  parts_depot: "package",
  difficult_access: "alert",
  other: "dot",
};
// Vue de départ sans aucun point : France métropolitaine.
const INITIAL_MAP_CENTER = [46.6, 2.4];
const INITIAL_MAP_ZOOM = 6;
// Au premier affichage, la carte se cadre sur les points existants, sans zoomer plus près que ça.
const MAXIMUM_ZOOM_WHEN_FITTING_POINTS = 14;
const WHOLE_WORLD_BOUNDING_BOX = { south: -90, west: -180, north: 90, east: 180 };
const NEARBY_RADIUS_METERS = 5_000;

const mapStatus = document.querySelector("[data-map-status]");
const mapHint = document.querySelector("[data-map-hint]");
const categoryFiltersGroup = document.querySelector("[data-category-filters]");
const pointFormPanel = document.querySelector("[data-point-form-panel]");
const pointForm = document.querySelector("[data-point-form]");
const pointFormTitle = document.querySelector("[data-point-form-title]");
const pointFormCoordinates = document.querySelector("[data-point-form-coordinates]");
const pointFormError = document.querySelector("[data-point-form-error]");
const nearbyPanel = document.querySelector("[data-nearby-panel]");
const nearbyList = document.querySelector("[data-nearby-list]");
const nearbySummary = document.querySelector("[data-nearby-summary]");

/** État du formulaire : création à des coordonnées, ou modification d'un point existant. */
let pointBeingEdited = null;
let coordinatesOfNewPoint = null;
let currentPositionMarker = null;
const markersByPointId = new Map();
/** Catégorie affichée ("" = toutes) et derniers points chargés (pour refiltrer sans requête). */
let selectedCategory = "";
let lastLoadedPoints = [];

function showStatus(message) {
  mapStatus.textContent = message;
  mapStatus.hidden = !message;
}

function fillCategoryOptions() {
  for (const [categoryValue, categoryLabel] of Object.entries(CATEGORY_LABELS)) {
    pointForm.elements.category.add(new Option(categoryLabel, categoryValue));
  }
}

/**
 * Filtres en pastilles : « Tous » puis une pastille colorée par catégorie,
 * avec le nombre de points de la zone visible. Elles servent aussi de légende.
 */
function renderCategoryFilters(leafletMap) {
  const pointCountByCategory = new Map();
  for (const point of lastLoadedPoints) {
    pointCountByCategory.set(point.category, (pointCountByCategory.get(point.category) ?? 0) + 1);
  }
  const filterChoices = [
    ["", "Tous", lastLoadedPoints.length],
    ...Object.entries(CATEGORY_LABELS).map(([categoryValue, categoryLabel]) => [categoryValue, categoryLabel, pointCountByCategory.get(categoryValue) ?? 0]),
  ];
  categoryFiltersGroup.replaceChildren(
    ...filterChoices.map(([categoryValue, categoryLabel, pointCount]) => {
      const filterButton = createElementWithText("button", "map-category-filter");
      filterButton.type = "button";
      filterButton.setAttribute("role", "radio");
      filterButton.setAttribute("aria-checked", String(categoryValue === selectedCategory));
      if (categoryValue) {
        filterButton.append(createElementWithText("span", `map-category-dot map-category-${categoryValue}`));
      }
      filterButton.append(createElementWithText("span", "", categoryLabel), createElementWithText("span", "map-category-count", String(pointCount)));
      filterButton.addEventListener("click", () => {
        selectedCategory = categoryValue;
        renderCategoryFilters(leafletMap);
        displayPoints(leafletMap);
      });
      return filterButton;
    }),
  );
}

async function createMap() {
  const { attribution, maximumZoom } = await requestJson("/api/map/settings");
  const mapCanvas = document.querySelector("[data-map-canvas]");
  const leafletMap = L.map(mapCanvas, { maxZoom: maximumZoom, worldCopyJump: true });
  leafletMap.setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);
  // La zone de la carte change de taille après coup (rail de navigation posé, fenêtre
  // redimensionnée, rotation du téléphone) : sans ça, le fond MapLibre garde l'ancienne taille.
  new ResizeObserver(() => leafletMap.invalidateSize()).observe(mapCanvas);
  // Style MapLibre minimal : une seule couche, les tuiles raster relayées par le serveur.
  // Attribution OBLIGATOIRE du fournisseur de tuiles (licence OpenStreetMap). Ajoutée
  // directement au contrôle Leaflet : le pont MapLibre ne transmet pas l'option attribution.
  // addAttribution insère du HTML : le texte (configuration serveur) est échappé par précaution.
  leafletMap.attributionControl.addAttribution(escapeHtmlText(attribution));
  L.maplibreGL({
    style: {
      version: 8,
      sources: {
        backgroundTiles: {
          type: "raster",
          tiles: [`${window.location.origin}/api/map/tiles/{z}/{x}/{y}`],
          tileSize: 256,
          maxzoom: maximumZoom,
        },
      },
      layers: [{ id: "backgroundTiles", type: "raster", source: "backgroundTiles" }],
    },
  }).addTo(leafletMap);
  return leafletMap;
}

function escapeHtmlText(text) {
  const htmlEscapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return text.replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

// --- Chargement des points de la zone visible --------------------------------

/** Zone visible ramenée à des longitudes valides (la carte peut faire plusieurs tours du monde). */
function readVisibleBoundingBox(leafletMap) {
  const bounds = leafletMap.getBounds();
  const longitudeSpan = bounds.getEast() - bounds.getWest();
  const wrapLongitude = (longitude) => L.Util.wrapNum(longitude, [-180, 180], true);
  return {
    south: Math.max(-90, bounds.getSouth()),
    north: Math.min(90, bounds.getNorth()),
    west: longitudeSpan >= 360 ? -180 : wrapLongitude(bounds.getWest()),
    east: longitudeSpan >= 360 ? 180 : wrapLongitude(bounds.getEast()),
  };
}

function requestPointsInBoundingBox(boundingBox) {
  const searchParameters = new URLSearchParams(Object.entries(boundingBox).map(([key, value]) => [key, value.toFixed(6)]));
  return requestJson(`/api/map/points?${searchParameters}`);
}

async function reloadVisiblePoints(leafletMap) {
  try {
    const { points } = await requestPointsInBoundingBox(readVisibleBoundingBox(leafletMap));
    showStatus("");
    lastLoadedPoints = points;
    renderCategoryFilters(leafletMap);
    displayPoints(leafletMap);
  } catch (error) {
    showStatus(`Points non chargés : ${error.message}`);
  }
}

/** Premier affichage : cadre la carte sur tous les points (sinon, vue sur la France). */
async function fitMapToAllPoints(leafletMap) {
  try {
    const { points } = await requestPointsInBoundingBox(WHOLE_WORLD_BOUNDING_BOX);
    if (points.length > 0) {
      const pointsBounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
      leafletMap.fitBounds(pointsBounds, { padding: [80, 80], maxZoom: MAXIMUM_ZOOM_WHEN_FITTING_POINTS });
    }
  } catch {
    // Pas grave : la vue par défaut reste, et reloadVisiblePoints signalera l'erreur.
  }
}

/** Épingle en goutte, couleur et icône de la catégorie (élément DOM, pas de HTML en texte). */
function createPinIcon(category) {
  const pinBody = createElementWithText("span", `map-pin-body map-category-${category}`);
  pinBody.append(createIcon(CATEGORY_ICON_NAMES[category] ?? "dot"));
  return L.divIcon({ html: pinBody, className: "map-pin", iconSize: [34, 34], iconAnchor: [17, 40], popupAnchor: [0, -38] });
}

function displayPoints(leafletMap) {
  const visiblePoints = selectedCategory ? lastLoadedPoints.filter((point) => point.category === selectedCategory) : lastLoadedPoints;
  const visiblePointIds = new Set(visiblePoints.map((point) => point.id));
  for (const [pointId, marker] of markersByPointId) {
    if (!visiblePointIds.has(pointId)) {
      marker.remove();
      markersByPointId.delete(pointId);
    }
  }
  for (const point of visiblePoints) {
    markersByPointId.get(point.id)?.remove();
    const marker = L.marker([point.latitude, point.longitude], { icon: createPinIcon(point.category), title: point.title, riseOnHover: true });
    marker.bindPopup(() => createPointPopupContent(leafletMap, point), { maxWidth: 300, minWidth: 220 });
    marker.addTo(leafletMap);
    markersByPointId.set(point.id, marker);
  }
}

/** Contenu de la bulle, construit élément par élément (textContent). */
function createPointPopupContent(leafletMap, point) {
  const popupContent = createElementWithText("div");
  const categoryBadge = createElementWithText("span", "badge map-point-popup-category");
  categoryBadge.append(
    createElementWithText("span", `map-category-dot map-category-${point.category}`),
    createElementWithText("span", "", CATEGORY_LABELS[point.category] ?? point.category),
  );
  popupContent.append(categoryBadge, createElementWithText("strong", "map-point-popup-title", point.title));
  if (point.description) {
    popupContent.append(createElementWithText("p", "map-point-popup-description", point.description));
  }
  popupContent.append(
    createElementWithText(
      "div",
      "map-point-popup-author",
      `Ajouté par ${point.createdByUsername ?? "un ancien utilisateur"} · modifié ${formatDateTime(point.updatedAt)}`,
    ),
  );
  if (point.canModify) {
    const actions = createElementWithText("div", "map-point-popup-actions");
    const editButton = createButton("Modifier", {
      className: "button button-secondary button-small",
      onClick: () => openPointForm({ pointToEdit: point }),
    });
    editButton.prepend(createIcon("edit"));
    const deleteButton = createButton("Supprimer", {
      className: "button button-danger button-small",
      onClick: async () => {
        if (!window.confirm(`Supprimer le point « ${point.title} » ?`)) {
          return;
        }
        try {
          await requestJson(`/api/map/points/${point.id}`, { method: "DELETE" });
          leafletMap.closePopup();
          await reloadVisiblePoints(leafletMap);
        } catch (error) {
          showStatus(error.message);
        }
      },
    });
    deleteButton.prepend(createIcon("trash"));
    actions.append(editButton, deleteButton);
    popupContent.append(actions);
  }
  return popupContent;
}

// --- Formulaire de création / modification ----------------------------------

function openPointForm({ pointToEdit = null, coordinates = null }) {
  pointBeingEdited = pointToEdit;
  coordinatesOfNewPoint = coordinates;
  pointForm.reset();
  pointFormError.hidden = true;
  nearbyPanel.hidden = true;
  mapHint.hidden = true;
  pointFormTitle.textContent = pointToEdit ? "Modifier le lieu" : "Nouveau lieu";
  if (pointToEdit) {
    pointForm.elements.title.value = pointToEdit.title;
    pointForm.elements.category.value = pointToEdit.category;
    pointForm.elements.description.value = pointToEdit.description;
  }
  const { latitude, longitude } = pointToEdit ?? coordinates;
  pointFormCoordinates.textContent = `Position : ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  if (!pointToEdit && selectedCategory) {
    pointForm.elements.category.value = selectedCategory; // filtre actif = catégorie proposée
  }
  pointFormPanel.hidden = false;
  pointForm.elements.title.focus();
}

function closePointForm() {
  pointFormPanel.hidden = true;
  mapHint.hidden = false;
  pointBeingEdited = null;
  coordinatesOfNewPoint = null;
}

async function savePointForm(leafletMap) {
  const pointContent = {
    title: pointForm.elements.title.value,
    category: pointForm.elements.category.value,
    description: pointForm.elements.description.value,
  };
  if (!pointContent.title.trim()) {
    pointFormError.textContent = "Donnez un titre au point.";
    pointFormError.hidden = false;
    return;
  }
  try {
    if (pointBeingEdited) {
      await requestJson(`/api/map/points/${pointBeingEdited.id}`, { method: "PATCH", body: pointContent });
    } else {
      await requestJson("/api/map/points", { method: "POST", body: { ...pointContent, ...coordinatesOfNewPoint } });
    }
    closePointForm();
    leafletMap.closePopup();
    await reloadVisiblePoints(leafletMap);
  } catch (error) {
    pointFormError.textContent = error.message;
    pointFormError.hidden = false;
  }
}

// --- Ma position et points proches -----------------------------------------

function locateCurrentUser(leafletMap) {
  if (!navigator.geolocation) {
    showStatus("La géolocalisation n'est pas disponible sur cet appareil.");
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        // La position reste dans le navigateur : rien n'est envoyé tant qu'on ne crée pas de point.
        const currentPosition = [coords.latitude, coords.longitude];
        currentPositionMarker?.remove();
        currentPositionMarker = L.circleMarker(currentPosition, { radius: 8, className: "current-position-marker" })
          .bindTooltip("Vous êtes ici")
          .addTo(leafletMap);
        leafletMap.setView(currentPosition, Math.max(leafletMap.getZoom(), 15));
        showStatus("");
        resolve({ latitude: coords.latitude, longitude: coords.longitude });
      },
      () => {
        showStatus("Position introuvable : autorisez la localisation pour ce site.");
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

async function showNearbyPoints(leafletMap) {
  const center = currentPositionMarker?.getLatLng() ?? leafletMap.getCenter();
  const searchParameters = new URLSearchParams({ lat: center.lat.toFixed(6), lng: center.lng.toFixed(6), radius: NEARBY_RADIUS_METERS });
  try {
    const { points } = await requestJson(`/api/map/points/nearby?${searchParameters}`);
    closePointForm();
    nearbySummary.textContent = `${points.length} point(s) à moins de ${NEARBY_RADIUS_METERS / 1000} km ${currentPositionMarker ? "de vous" : "du centre de la carte"}.`;
    nearbyList.replaceChildren(
      ...points.map((point) => {
        const listItem = document.createElement("li");
        const focusButton = createButton("", {
          className: "nearby-point-button",
          onClick: () => {
            leafletMap.setView([point.latitude, point.longitude], Math.max(leafletMap.getZoom(), 16));
            markersByPointId.get(point.id)?.openPopup();
          },
        });
        const pointText = createElementWithText("span", "nearby-point-text");
        pointText.append(
          createElementWithText("span", "nearby-point-title", point.title),
          createElementWithText("span", "nearby-point-category", CATEGORY_LABELS[point.category] ?? point.category),
        );
        focusButton.append(
          createElementWithText("span", `map-category-dot map-category-${point.category}`),
          pointText,
          createElementWithText("span", "badge", formatDistance(point.distanceMeters)),
        );
        listItem.append(focusButton);
        return listItem;
      }),
    );
    nearbyPanel.hidden = false;
  } catch (error) {
    showStatus(error.message);
  }
}

function formatDistance(distanceMeters) {
  return distanceMeters < 1000 ? `${distanceMeters} m` : `${(distanceMeters / 1000).toFixed(1)} km`;
}

// --- Démarrage ---------------------------------------------------------------

fillCategoryOptions();
try {
  const leafletMap = await createMap();
  let reloadTimer = null;
  leafletMap.on("moveend", () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => reloadVisiblePoints(leafletMap), 250);
  });
  leafletMap.on("click", ({ latlng }) => {
    openPointForm({ coordinates: { latitude: latlng.lat, longitude: L.Util.wrapNum(latlng.lng, [-180, 180], true) } });
  });
  pointForm.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    savePointForm(leafletMap);
  });
  for (const cancelButton of document.querySelectorAll("[data-cancel-point-form]")) {
    cancelButton.addEventListener("click", closePointForm);
  }
  document.querySelector("[data-close-nearby]").addEventListener("click", () => {
    nearbyPanel.hidden = true;
  });
  document.querySelector("[data-locate-me]").addEventListener("click", () => locateCurrentUser(leafletMap));
  document.querySelector("[data-show-nearby]").addEventListener("click", () => showNearbyPoints(leafletMap));
  renderCategoryFilters(leafletMap);
  await fitMapToAllPoints(leafletMap);
  await reloadVisiblePoints(leafletMap);
} catch (error) {
  showStatus(`Carte indisponible : ${error.message}`);
}
