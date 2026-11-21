const statusElement = document.querySelector("#status");
const locateButton = document.querySelector("#locateButton");

// Anoka County GIS parcel/tax-information layer.
const parcelQueryUrl =
  "https://gisservices.co.anoka.mn.us/anoka_gis/rest/services/" +
  "OpenData_TaxInfo/FeatureServer/0/query";

const map = L.map("map").setView([45.25, -93.25], 15);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let parcelLayer = null;
let locationMarker = null;
let locationAccuracyCircle = null;
let requestNumber = 0;
let refreshTimer = null;
let locationWatchId = null;

function setStatus(message) {
  statusElement.textContent = message;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }

  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString(undefined, { maximumFractionDigits: digits })
    : String(value);
}

function addPopupLine(container, label, value) {
  const paragraph = document.createElement("p");
  const labelElement = document.createElement("strong");

  labelElement.textContent = `${label}: `;
  paragraph.append(labelElement, document.createTextNode(value));
  container.append(paragraph);
}

function makeParcelPopup(properties = {}) {
  const popup = document.createElement("div");
  popup.className = "parcel-popup";

  addPopupLine(popup, "Parcel ID", properties.PIN || "Not available");

  const address = [
    properties.LOC_ADDR,
    properties.LOC_CITY
  ].filter(Boolean).join(", ");

  addPopupLine(popup, "Address", address || "Not available");
  addPopupLine(popup, "Acres", formatNumber(properties.ACRES, 2));
  addPopupLine(popup, "Tax year", formatNumber(properties.TAX_YEAR, 0));
  addPopupLine(popup, "Total tax", formatNumber(properties.TOTAL_TAX, 0));
  addPopupLine(popup, "Market value", formatNumber(properties.MKT_VALUE, 0));

  return popup;
}

async function loadParcels() {
  if (map.getZoom() < 14) {
    setStatus("Zoom in to load parcel outlines.");
    return;
  }

  const thisRequest = ++requestNumber;
  const bounds = map.getBounds();

  // ArcGIS expects the envelope coordinates in the spatial reference
  // given by inSR. Leaflet's bounds are longitude/latitude.
  const geometry = {
    xmin: bounds.getWest(),
    ymin: bounds.getSouth(),
    xmax: bounds.getEast(),
    ymax: bounds.getNorth(),
    spatialReference: { wkid: 4326 }
  };

  const params = new URLSearchParams({
    where: "1=1",
    outFields: "PIN,OWNER,LOC_ADDR,LOC_CITY,ACRES,TAX_YEAR,TOTAL_TAX,MKT_VALUE",
    returnGeometry: "true",
    geometry: JSON.stringify(geometry),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "1500",
    geometryPrecision: "5",
    f: "geojson"
  });

  setStatus("Loading parcels…");

  try {
    const response = await fetch(`${parcelQueryUrl}?${params}`);

    if (!response.ok) {
      throw new Error(`County GIS request failed (${response.status}).`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || "County GIS returned an error.");
    }

    // Ignore an older request if the user moved the map while it was loading.
    if (thisRequest !== requestNumber) return;

    if (parcelLayer) {
      map.removeLayer(parcelLayer);
    }

    parcelLayer = L.geoJSON(data, {
      style: {
        color: "#276749",
        weight: 1,
        fillColor: "#79b77b",
        fillOpacity: 0.12
      },
      onEachFeature(feature, layer) {
        layer.bindPopup(makeParcelPopup(feature.properties));

        const owner = feature.properties?.OWNER;

        if (owner) {
          const label = document.createElement("span");
          label.textContent = owner;

          layer.bindTooltip(label, {
            sticky: true,
            direction: "top"
          });
        }
      }
    }).addTo(map);

    const count = data.features?.length ?? 0;
    setStatus(`${count} parcels loaded in this map view.`);
  } catch (error) {
    console.error(error);
    setStatus(
      "Could not load parcels. Check your internet connection and browser console."
    );
  }
}

function scheduleParcelRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadParcels, 500);
}

map.on("moveend", scheduleParcelRefresh);
loadParcels();

locateButton.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    setStatus("Location is not available in this browser.");
    return;
  }

  if (locationWatchId !== null) {
    setStatus("Already tracking your location.");
    return;
  }

  setStatus("Getting your location…");
  let firstFix = true;

  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const accuracy = position.coords.accuracy;
      const location = [latitude, longitude];

      if (locationMarker) map.removeLayer(locationMarker);
      if (locationAccuracyCircle) map.removeLayer(locationAccuracyCircle);

      locationMarker = L.marker(location)
        .addTo(map)
        .bindPopup(`Your location (about ${Math.round(accuracy)} m accuracy)`);

      locationAccuracyCircle = L.circle(location, {
        radius: accuracy,
        color: "#1769aa",
        fillColor: "#1769aa",
        fillOpacity: 0.12,
        weight: 1
      }).addTo(map);

      if (firstFix) {
        map.setView(location, 17);
        firstFix = false;
      }

      setStatus(
        `Tracking location; reported accuracy is about ${Math.round(accuracy)} m.`
      );
    },
    (error) => {
      console.error(error);

      if (error.code === error.PERMISSION_DENIED) {
        setStatus("Location permission was denied. Allow it in browser settings to try again.");
      } else {
        setStatus("Could not get a location fix. Try again outdoors.");
      }
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 20000
    }
  );
});
