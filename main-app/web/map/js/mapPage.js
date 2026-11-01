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
// Vue de départ : France métropolitaine.
const INITIAL_MAP_CENTER = [46.6, 2.4];
const INITIAL_MAP_ZOOM = 6;
const NEARBY_RADIUS_METERS = 5_000;

const mapStatus = document.querySelector("[data-map-status]");
const categoryFilter = document.querySelector("[data-category-filter]");
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

function showStatus(message) {
  mapStatus.textContent = message;
  mapStatus.hidden = !message;
}

function fillCategoryOptions() {
  for (const [categoryValue, categoryLabel] of Object.entries(CATEGORY_LABELS)) {
    categoryFilter.add(new Option(categoryLabel, categoryValue));
    pointForm.elements.category.add(new Option(categoryLabel, categoryValue));
  }
}

async function createMap() {
  const { attribution, maximumZoom } = await requestJson("/api/map/settings");
  const leafletMap = L.map(document.querySelector("[data-map-canvas]"), { maxZoom: maximumZoom, worldCopyJump: true });
  leafletMap.setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);
  // Style MapLibre minimal : une seule couche, les tuiles raster relayées par le serveur.
  L.maplibreGL({
    attribution,
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

async function reloadVisiblePoints(leafletMap) {
  const searchParameters = new URLSearchParams(Object.entries(readVisibleBoundingBox(leafletMap)).map(([key, value]) => [key, value.toFixed(6)]));
  try {
    const { points } = await requestJson(`/api/map/points?${searchParameters}`);
    showStatus("");
    displayPoints(leafletMap, points);
  } catch (error) {
    showStatus(`Points non chargés : ${error.message}`);
  }
}

function displayPoints(leafletMap, points) {
  const selectedCategory = categoryFilter.value;
  const visiblePoints = selectedCategory ? points.filter((point) => point.category === selectedCategory) : points;
  const visiblePointIds = new Set(visiblePoints.map((point) => point.id));
  for (const [pointId, marker] of markersByPointId) {
    if (!visiblePointIds.has(pointId)) {
      marker.remove();
      markersByPointId.delete(pointId);
    }
  }
  for (const point of visiblePoints) {
    markersByPointId.get(point.id)?.remove();
    const marker = L.circleMarker([point.latitude, point.longitude], {
      radius: 9,
      className: `map-point-marker map-point-category-${point.category}`,
    });
    marker.bindPopup(() => createPointPopupContent(leafletMap, point), { maxWidth: 280 });
    marker.addTo(leafletMap);
    markersByPointId.set(point.id, marker);
  }
}

/** Contenu de la bulle, construit élément par élément (textContent). */
function createPointPopupContent(leafletMap, point) {
  const popupContent = createElementWithText("div");
  popupContent.append(
    createElementWithText("strong", "map-point-popup-title", point.title),
    createElementWithText("span", "map-point-popup-category", CATEGORY_LABELS[point.category] ?? point.category),
  );
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
    actions.append(
      createButton("Modifier", { onClick: () => openPointForm({ pointToEdit: point }) }),
      createButton("Supprimer", {
        className: "button button-danger",
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
      }),
    );
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
  pointFormTitle.textContent = pointToEdit ? "Modifier le point" : "Nouveau point";
  if (pointToEdit) {
    pointForm.elements.title.value = pointToEdit.title;
    pointForm.elements.category.value = pointToEdit.category;
    pointForm.elements.description.value = pointToEdit.description;
  }
  const { latitude, longitude } = pointToEdit ?? coordinates;
  pointFormCoordinates.textContent = `Position : ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  pointFormPanel.hidden = false;
  pointForm.elements.title.focus();
}

function closePointForm() {
  pointFormPanel.hidden = true;
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
        listItem.append(
          createButton(`${point.title} (${formatDistance(point.distanceMeters)})`, {
            className: "",
            onClick: () => {
              leafletMap.setView([point.latitude, point.longitude], Math.max(leafletMap.getZoom(), 16));
            },
          }),
        );
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
  categoryFilter.addEventListener("change", () => reloadVisiblePoints(leafletMap));
  pointForm.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    savePointForm(leafletMap);
  });
  document.querySelector("[data-cancel-point-form]").addEventListener("click", closePointForm);
  document.querySelector("[data-close-nearby]").addEventListener("click", () => {
    nearbyPanel.hidden = true;
  });
  document.querySelector("[data-locate-me]").addEventListener("click", () => locateCurrentUser(leafletMap));
  document.querySelector("[data-show-nearby]").addEventListener("click", () => showNearbyPoints(leafletMap));
  await reloadVisiblePoints(leafletMap);
} catch (error) {
  showStatus(`Carte indisponible : ${error.message}`);
}
