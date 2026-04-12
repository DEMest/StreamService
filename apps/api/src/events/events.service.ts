import { Injectable } from "@nestjs/common";

export interface EventDto {
  id: string;
  title: string;
  streamUrl: string;
  mats: string[];
  layoutMode: "quad" | "focus";
}

@Injectable()
export class EventsService {
  getCurrent(): EventDto {
    return {
      id: "evt-001",
      title: "Regional Wrestling Tournament 2026",
      streamUrl: process.env.STREAM_URL ?? "/hls/live/stream/index.m3u8",
      mats: ["Mat 1", "Mat 2", "Mat 3", "Mat 4"],
      layoutMode: "quad",
    };
  }
}
