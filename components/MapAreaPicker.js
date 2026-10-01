'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [-1.286389, 36.817223]; // Nairobi — just the initial view, not a search default
const DEFAULT_RADIUS_KM = 5;

// Rough km-per-degree conversion for a small bbox around a point. Fine at
// city/district scale (what this picker is for); not meant for huge radii or
// areas near the poles where the longitude-degree approximation breaks down.
function bboxFromCenterRadius(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  return { south: lat - latDelta, north: lat + latDelta, west: lon - lonDelta, east: lon + lonDelta };
}

/**
 * Click-to-center + radius-slider map area picker — an alternative to typing
 * a city name that then has to be geocoded (and can be geocoded wrong, or too
 * broad/narrow). Calls onChange({ bbox, center, radiusKm }) whenever the
 * picked area changes; the bbox is what actually reaches the discovery
 * provider (see lib/services/discovery/providers/osm-overpass.js), bypassing
 * geocoding entirely.
 *
 * Leaflet is dynamically imported inside effects (never at module scope) —
 * it touches `window`/`document` on use, which breaks server-side rendering.
 * The center marker is a plain circleMarker (a dot), not L.marker, so this
 * never needs Leaflet's default pin icon images — those are a well-known
 * bundler headache (relative image paths that don't resolve after bundling)
 * and a colored dot serves the exact same purpose here.
 */
export default function MapAreaPicker({ onChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ marker: null, circle: null });
  const [center, setCenter] = useState(null);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);

  useEffect(() => {
    let cancelled = false;
    let map;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;
      map = L.map(containerRef.current).setView(DEFAULT_CENTER, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      map.on('click', (e) => setCenter({ lat: e.latlng.lat, lon: e.latlng.lng }));
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !center) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      const map = mapRef.current;
      const { marker, circle } = layersRef.current;
      if (marker) map.removeLayer(marker);
      if (circle) map.removeLayer(circle);
      layersRef.current.marker = L.circleMarker([center.lat, center.lon], {
        radius: 6, color: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 1,
      }).addTo(map);
      layersRef.current.circle = L.circle([center.lat, center.lon], {
        radius: radiusKm * 1000, color: '#2563eb', weight: 1, fillOpacity: 0.08,
      }).addTo(map);
      onChange({ bbox: bboxFromCenterRadius(center.lat, center.lon, radiusKm), center, radiusKm });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a fresh function each parent render; re-running on it would fight the map, not help it.
  }, [center, radiusKm]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} style={{ height: 260 }} className="w-full overflow-hidden rounded-lg border border-gray-300" />
      {center ? (
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <span className="whitespace-nowrap">Radius: {radiusKm} km</span>
          <input
            type="range" min="1" max="30" value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="flex-1"
          />
        </div>
      ) : (
        <p className="text-xs text-gray-400">Click the map to drop a search center, then adjust the radius.</p>
      )}
    </div>
  );
}
