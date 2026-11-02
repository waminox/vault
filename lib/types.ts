export interface Variant {
  blob: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
}

export interface Storyboard {
  cols: number;
  rows: number;
  /** Seconds between tiles. */
  interval: number;
  tileW: number;
  tileH: number;
  count: number;
}

export interface Variants {
  original?: Variant;
  thumb?: Variant;
  preview?: Variant;
  poster?: Variant;
  playback?: Variant;
  storyboard?: Variant & Storyboard;
}

export type VariantName = keyof Variants;

export interface ItemDTO {
  id: string;
  albumId: string | null;
  kind: "image" | "video";
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  takenAt: number | null;
  createdAt: number;
  /** Changes whenever the item changes; used to bust media caches. */
  rev: number;
  /** Fractional index for manual ordering inside an album. */
  position: string;
  favorite: boolean;
  deletedAt: number | null;
  color: string | null;
  status: "processing" | "ready" | "failed";
  progress: number | null;
  error: string | null;
  has: Record<"thumb" | "preview" | "poster" | "playback" | "original", boolean>;
  storyboard: Storyboard | null;
}

export interface AlbumDTO {
  id: string;
  name: string;
  count: number;
  bytes: number;
  coverId: string | null;
  coverRev: number | null;
  createdAt: number;
}

export type View = "all" | "photos" | "videos" | "favorites" | "unsorted" | "trash" | "album";
export type SortKey = "manual" | "added" | "taken" | "name" | "size" | "duration";

export interface ListQuery {
  view: View;
  albumId?: string;
  kind?: "image" | "video";
  sort: SortKey;
  dir: "asc" | "desc";
  q?: string;
  offset: number;
  limit: number;
}

export interface Stats {
  photos: number;
  videos: number;
  favorites: number;
  unsorted: number;
  trash: number;
  bytes: number;
  storedBytes: number;
  processing: number;
}

export interface UploadStatus {
  id: string;
  chunkSize: number;
  totalChunks: number;
  received: number[];
}
