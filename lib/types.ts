export interface EventDoc {
  _id: string;
  slug: string;
  name: string;
  description?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoDoc {
  _id: string;
  eventId: string;
  lat: number;
  lng: number;
  url: string;
  width?: number;
  height?: number;
  size: number;
  takenAt?: string | null;
  uploader?: string | null;
  createdAt: string;
}

export interface RouteDoc {
  _id: string;
  eventId: string;
  name: string;
  color: string;
  url: string;
  size: number;
  createdAt: string;
}
