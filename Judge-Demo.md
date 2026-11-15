# Lunar Window judge demo

## 30-second submission video

| Time | On screen | Narration |
|---|---|---|
| 0–5 s | Show the opening result and selected sites | “At the lunar south pole, a ridge can hide Earth from a lander.” |
| 5–14 s | Toggle **Flat reference** to **LOLA terrain** at 2 m | “Our demo favors Malapert on flat terrain. Add NASA’s elevation data and de Gerlache has the shorter outage.” |
| 14–23 s | Show **Antenna-height sensitivity** | “At Malapert, the modeled blackout ranges from 10.9 to 20.5 hours across two heights.” |
| 23–30 s | Show the two-hour report deadline and confidence panel | “Neither site meets two hours in this demo. A planner could test later touchdown times or relay coverage.” |

See NASA Space Apps’ [Resources](https://www.spaceappschallenge.org/resources/) for the Project Submission Guide.

## Three-minute live walkthrough

1. **0:00–0:25 · Problem.** A lander’s solar panel and Earth antenna face different visibility constraints. An unbroken shadow interval can drive battery sizing. A lost Earth sightline removes the direct radio path.
2. **0:25-1:10 · Change the model.** Set touchdown to 17 November 2026 at 00:00 UTC and duration to 24 hours. At 2 m, Malapert and de Gerlache go from 0.0 and 1.1 h with the flat reference to 20.5 and 7.7 h with terrain. The height table shows 10.9 and 7.6 h at 5 m. Call these modeled results for this window.
3. **1:10–1:55 · Show an electrical trade-off.** Select Shackleton Rim. Read its Sun and Earth cards, then select Connecting Ridge and show how the Earth timeline changes in the same period. Scrub to a blocked time and match the Earth marker to the terrain skyline.
4. **1:55-2:35 · Show the check.** Open **How accurate is this?** The direct Horizons comparison tests the projection at two sites. With the terrain fixed, the longest outage changes by less than 0.001 minutes. The coarser custom terrain shifts Malapert by about nine hours. Explain that the terrain resolution drives this sensitivity.
5. **2:35-3:00 · Engineering use.** Set the first-report deadline to two hours at 2 m with terrain and show that both sites miss it. Explain how a team could screen later touchdown times or relay coverage, and use the longest solar shadow separately for battery sizing.

The example numbers are model outputs for the stated time window, with a 2 m observer. Use the 30-day control after demonstrating the 24-hour figures.
