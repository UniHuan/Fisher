interface TMapLatLng {
  lat: number;
  lng: number;
}

interface TMapClickEvent {
  latLng: TMapLatLng;
}

interface TMapMapInstance {
  on(event: 'click', handler: (event: TMapClickEvent) => void): void;
  setCenter(position: TMapLatLng): void;
  destroy(): void;
}

interface TMapMarkerInstance {
  setGeometries(geometries: Array<{ id: string; position: TMapLatLng }>): void;
}

interface TMapSuggestionResult {
  id?: string;
  title?: string;
  address?: string;
  location?: { lat: number; lng: number };
}

interface TMapGeocoderResult {
  result?: {
    address?: string;
    formatted_addresses?: { recommend?: string };
  };
}

interface TMapGeocoderInstance {
  getAddress(options: {
    location: TMapLatLng;
  }): Promise<TMapGeocoderResult>;
}

interface TMapSuggestionInstance {
  getSuggestions(options: {
    keyword: string;
    region?: string;
    region_fix?: number;
    page_size?: number;
  }): Promise<{ data?: TMapSuggestionResult[] }>;
}

declare const TMap: {
  Map: new (
    container: HTMLElement,
    options: { center: TMapLatLng; zoom: number; viewMode?: string },
  ) => TMapMapInstance;
  LatLng: new (lat: number, lng: number) => TMapLatLng;
  MultiMarker: new (options: {
    map: TMapMapInstance;
    geometries: Array<{ id: string; position: TMapLatLng }>;
  }) => TMapMarkerInstance;
  service: {
    Geocoder: new (options?: { key?: string }) => TMapGeocoderInstance;
    Suggestion: new (options?: { pageSize?: number }) => TMapSuggestionInstance;
  };
};
