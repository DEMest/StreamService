# Architecture

## Target architecture

```
vMix (encoder)
  │  4K 2×2 composite — one SRT stream
  ▼
MediaMTX (media relay)
  │  SRT in → HLS out
  ▼
Browser (HLS.js player)
  │  single <video> element
  └─ CSS transform → quad view or focused mat view
```

MediaMTX receives the single SRT contribution from vMix and re-serves it as HLS.
The browser loads one HLS playlist. All mat-switching logic is purely CSS — no
server-side stream splitting or transcoding is needed in the MVP.

## Why one composite stream?

Wrestling tournaments run 4 simultaneous mat bouts. The natural capture approach
is one wide composite shot in a 2×2 grid. Broadcasting it as a **single SRT
stream** means:

- **One encoder process** on the vMix workstation
- **One ingest connection** to MediaMTX
- **One HLS playlist** delivered to each viewer
- **Zero server-side per-mat transcoding** — cheaper infra, less latency

The alternative — 4 separate streams — would require 4× the bandwidth, 4× the
encoder outputs, 4 separate HLS origins, and a much more complex browser player.
For a local tournament with limited budget this is impractical.

## Why 4 separate viewer streams are NOT the MVP path

- Doubles or quadruples server load with no benefit at MVP scale
- Complicates the ingest side (vMix would need 4 separate outputs)
- Requires synchronised switching — impossible without a mixing layer
- Adds storage and delivery cost proportional to viewer count × stream count

A single composite stream scales to many viewers at the same cost as one stream.

## vMix integration (future)

When vMix is the upstream source:

1. vMix configures a **SRT output** (Streaming > SRT Push) pointing at
   `srt://<server>:8890?streamid=publish:live/stream`
2. MediaMTX receives it on the SRT listener
3. MediaMTX re-muxes to HLS on-the-fly
4. The browser player (HLS.js) subscribes to the HLS playlist

No changes to the browser player or API are needed when switching from a test
ffmpeg source to vMix.

## Mat layout convention

The composite frame is divided into a 2×2 grid:

```
+--------+--------+
|  Mat 1 |  Mat 2 |
+--------+--------+
|  Mat 3 |  Mat 4 |
+--------+--------+
```

This mapping is encoded in the browser (`apps/web/src/app/page.tsx`) as CSS
transform origins. If vMix uses a different layout, only the `QUAD_ORIGIN` map
in `page.tsx` needs updating — nothing else changes.
