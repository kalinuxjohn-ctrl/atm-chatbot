import { requestJson } from "/shared/js/apiClient.js";

export function createRoutePlanner({ map, locate, enabled, closeOtherPanels }) {
  const panel = document.querySelector("[data-route-panel]");
  const form = panel.querySelector("form");
  const status = panel.querySelector("[data-route-status]");
  const summary = panel.querySelector("[data-route-summary]");
  const departure = panel.querySelector("[data-route-departure]");
  const calculateButton = form.querySelector('[type="submit"]');
  let destination = null;
  let start = null;
  let pickingStart = false;
  let routeLayer = null;
  let startMarker = null;
  let generation = 0;

  function showStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  function clearRoute() {
    generation += 1;
    routeLayer?.remove();
    routeLayer = null;
    startMarker?.remove();
    startMarker = null;
    summary.textContent = "";
    calculateButton.disabled = !enabled;
  }

  function describeStart() {
    departure.textContent = start ? `Départ : ${start.latitude.toFixed(5)}, ${start.longitude.toFixed(5)}` : "Choisissez votre position ou un départ sur la carte.";
  }

  async function calculate() {
    clearRoute();
    if (!enabled) {
      showStatus("Itinéraires non configurés. Renseignez MAIN_APP_MAP_ROUTING_API_KEY dans .env.");
      return;
    }
    if (!start || !destination) {
      showStatus("Choisissez un départ et une destination.");
      return;
    }
    const currentGeneration = generation;
    calculateButton.disabled = true;
    showStatus("Calcul de l'itinéraire…");
    try {
      const route = await requestJson("/api/map/route", {
        method: "POST",
        body: {
          start,
          end: { latitude: destination.latitude, longitude: destination.longitude },
          mode: form.elements.mode.value,
          preference: form.elements.preference.value,
        },
      });
      if (currentGeneration !== generation) return;
      routeLayer = L.geoJSON({ type: "Feature", properties: {}, geometry: route.geometry }, { style: { color: "#2563eb", weight: 5, opacity: 0.9 } }).addTo(map);
      startMarker = L.circleMarker([start.latitude, start.longitude], { radius: 7, color: "#2563eb" }).bindTooltip("Départ").addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
      const distance = route.distanceMeters < 1000 ? `${Math.round(route.distanceMeters)} m` : `${(route.distanceMeters / 1000).toFixed(1)} km`;
      summary.textContent = `${distance} · environ ${Math.max(1, Math.ceil(route.durationSeconds / 60))} min. ${route.attribution}`;
      showStatus(route.warning || "");
    } catch (error) {
      if (currentGeneration === generation) showStatus(error.message);
    } finally {
      if (currentGeneration === generation) calculateButton.disabled = false;
    }
  }

  async function useCurrentPosition() {
    pickingStart = false;
    clearRoute();
    const currentGeneration = generation;
    showStatus("Recherche de votre position…");
    const position = await locate();
    if (currentGeneration !== generation) return;
    if (!position) {
      showStatus("Position indisponible : autorisez la localisation ou choisissez le départ sur la carte.");
      return;
    }
    start = position;
    describeStart();
    void calculate();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    pickingStart = false;
    void calculate();
  });
  form.addEventListener("change", () => {
    pickingStart = false;
    void calculate();
  });
  panel.querySelector("[data-route-locate]").addEventListener("click", () => void useCurrentPosition());
  panel.querySelector("[data-route-pick-start]").addEventListener("click", () => {
    clearRoute();
    pickingStart = true;
    showStatus("Cliquez sur la carte pour choisir le départ.");
  });
  panel.querySelector("[data-close-route]").addEventListener("click", close);
  panel.querySelector("[data-clear-route]").addEventListener("click", () => {
    pickingStart = false;
    clearRoute();
    showStatus("");
  });
  function close() {
    pickingStart = false;
    clearRoute();
    panel.hidden = true;
  }
  return {
    close,
    open(point) {
      pickingStart = false;
      clearRoute();
      destination = point;
      closeOtherPanels();
      panel.querySelector("[data-route-destination]").textContent = point.title;
      panel.hidden = false;
      describeStart();
      if (!enabled) {
        showStatus("Itinéraires non configurés. Renseignez MAIN_APP_MAP_ROUTING_API_KEY dans .env.");
      } else if (start) {
        void calculate();
      } else {
        void useCurrentPosition();
      }
    },
    selectStart(latlng) {
      if (!pickingStart) return false;
      pickingStart = false;
      start = { latitude: latlng.lat, longitude: L.Util.wrapNum(latlng.lng, [-180, 180], true) };
      describeStart();
      void calculate();
      return true;
    },
  };
}
