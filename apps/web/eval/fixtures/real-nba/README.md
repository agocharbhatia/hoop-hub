These are frozen historical NBA `playergamelog` responses for the **2024-25 Regular Season**, captured through the application's normal NBA adapter on **2026-10-02 UTC**. They are not claims about the current season or current player form.

| Player | Player ID | Recorded games | Dataset SHA-256 |
| --- | --- | ---: | --- |
| Nikola Jokic | 203999 | 70 | `32d94a981ac58fe897d9ca72f590688484777a1427aa03e6a294d680f6a05d57` |
| Victor Wembanyama | 1641705 | 46 | `610a936a3d01604d02b619b19c4a944e07e5fbfc729abb0a04e4a12772937e41` |

Each JSON preserves the actual headers and complete returned rows, normalized public request parameters, source URL, capture time, adapter cache/freshness flags, original cache timestamps and payload checksum. `sha256` hashes `JSON.stringify(dataset)` in its stored key order. The source flags are preserved as returned, including `isProvisional`; capturing an old season does not silently change those flags.

`src/lib/server/agent/real-nba-trend-gold.test.ts` verifies snapshot integrity and computes its oracle directly from raw game dates and statistic columns. A scripted adapter then checks canonical Jokic REB and Wembanyama BLK charts, player labels, separate date windows, and earlier-five/later-five table averages against that independent oracle. The fixtures and test contain no API keys, OpenAI calls, or expected values copied from model output.
