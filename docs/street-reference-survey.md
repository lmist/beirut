# Beirut street reference survey

Twelve Google Street View outdoor panoramas were collected on 2026-09-16 for
environment reference. The JPEGs and machine-readable metadata are kept in
`data/street-references/`, outside the web app's public assets.

| Reference | Intended use | Capture date |
| --- | --- | --- |
| Hamra | Sidewalks and storefront signs | 2023-04 |
| Manara | Coastal road and mature trees | 2023-04 |
| Verdun | Mixed-use street and sidewalks | 2023-04 |
| Badaro | Neighbourhood street and trees | 2023-04 |
| Museum Square | Street edge, paving and wayfinding | 2019-02 |
| Ras El Nabaa Bridge | Bridge approach and road furniture | 2019-02 |
| Salim Slam | Major junction, signs and roadway | 2021-05 |
| Downtown / Saifi | Central sidewalks and street signs | 2023-04 |
| Gemmayzeh | Street character, trees and storefronts | 2023-04 |
| Mar Mikhael | Sidewalks, poles and commercial frontage | 2020-08 |
| Karantina | Port-edge industrial street and signs | 2023-04 |
| Cola | Transport corridor and sidewalk condition | 2019-02 |

## Coverage and gaps

Each image is aimed from the nearest outdoor panorama returned for a named
target. Eleven panorama centres are within 36 metres of their targets; the
Karantina panorama is 161 metres away, so it is useful for general industrial
street character only. They are visual references, so a target may be partly
occluded and they do not establish exact asset placement. Capture dates range
from 2019 to 2023. The survey does not yet cover night lighting, interior
arcades, every bridge deck, or repeated treatment of one street across several
blocks.

## Three Beirut game deliveries

- A small parts run from **Museum Square** to **Badaro** through the Adliyeh
  edge: narrow streets, shade, and a clear change in pace.
- A night-shift coffee delivery from **Hamra** to **Mar Mikhael**: use the
  denser storefront character at both ends and a longer cross-city route.
- A port manifest pickup in **Karantina** with a handoff at **Saifi**: start
  on the industrial edge and finish among central lanes and sidewalks.

For a wide, legible vehicle spawn, use **Bechara El Khoury Road** near the
model point `x=245, z=40`; it is mapped as a primary road and sits well
inside the loaded city footprint.

## Source

Google Maps Platform Street View Static API. Panoramas are used as local art
reference only; the app does not serve or redistribute them. Full coordinates,
panorama positions, headings, and dates are recorded in
`data/street-references/survey.json`.
