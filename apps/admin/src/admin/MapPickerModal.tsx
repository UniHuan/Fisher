'use client';

import {
  Alert,
  Button,
  Checkbox,
  Input,
  List,
  Modal,
  Space,
  Typography,
} from 'antd';
import { useEffect, useRef, useState } from 'react';

interface MapPickerModalProps {
  open: boolean;
  initialLatitude: string | null;
  initialLongitude: string | null;
  onPick: (picked: {
    latitude: string;
    longitude: string;
    address: string | null;
  }) => void;
  onClose: () => void;
}

interface PickedPoint {
  lat: number;
  lng: number;
}

const DEFAULT_CENTER: PickedPoint = { lat: 22.5431, lng: 114.0579 };
const MAP_JS_KEY = process.env.NEXT_PUBLIC_TENCENT_MAP_JS_KEY ?? '';

let mapScriptPromise: Promise<void> | null = null;

function loadMapScript(key: string): Promise<void> {
  if (typeof TMap !== 'undefined') {
    return Promise.resolve();
  }
  if (mapScriptPromise !== null) {
    return mapScriptPromise;
  }
  mapScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.tencentMap = 'true';
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      mapScriptPromise = null;
      reject(new Error('腾讯地图 SDK 加载失败'));
    };
    document.head.appendChild(script);
  });
  return mapScriptPromise;
}

function initialPoint(latitude: string | null, longitude: string | null): PickedPoint {
  if (
    latitude === null ||
    longitude === null ||
    latitude.trim() === '' ||
    longitude.trim() === ''
  ) {
    return DEFAULT_CENTER;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return DEFAULT_CENTER;
}

export function MapPickerModal({
  open,
  initialLatitude,
  initialLongitude,
  onPick,
  onClose,
}: MapPickerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<TMapMapInstance | null>(null);
  const markerRef = useRef<TMapMarkerInstance | null>(null);
  const [selected, setSelected] = useState<PickedPoint | null>(null);
  const [pickedAddress, setPickedAddress] = useState('');
  const [updateAddress, setUpdateAddress] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<TMapSuggestionResult[]>([]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const point = initialPoint(initialLatitude, initialLongitude);
    setSelected(point);
    setPickedAddress('');
    setUpdateAddress(true);
    setKeyword('');
    setSuggestions([]);
    setError('');
    if (MAP_JS_KEY.trim() === '') {
      setSelected(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    loadMapScript(MAP_JS_KEY)
      .then(() => {
        if (cancelled || containerRef.current === null) {
          return;
        }
        const map = new TMap.Map(containerRef.current, {
          center: new TMap.LatLng(point.lat, point.lng),
          zoom: 15,
          viewMode: '2D',
        });
        const marker = new TMap.MultiMarker({
          map,
          geometries: [{ id: 'picked', position: new TMap.LatLng(point.lat, point.lng) }],
        });
        map.on('click', (event) => {
          const next = { lat: event.latLng.lat, lng: event.latLng.lng };
          setSelected(next);
          marker.setGeometries([
            { id: 'picked', position: new TMap.LatLng(next.lat, next.lng) },
          ]);
          setPickedAddress('');
          try {
            const geocoder = new TMap.service.Geocoder();
            void geocoder
              .getAddress({ location: new TMap.LatLng(next.lat, next.lng) })
              .then((result) => {
                const address =
                  result.result?.formatted_addresses?.recommend ??
                  result.result?.address ??
                  '';
                setPickedAddress(address);
              })
              .catch(() => undefined);
          } catch {
            // Reverse geocoding is best effort.
          }
        });
        mapRef.current = map;
        markerRef.current = marker;
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : '地图加载失败');
      });
    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [open, initialLatitude, initialLongitude]);

  const searchAddress = async (): Promise<void> => {
    if (keyword.trim() === '' || MAP_JS_KEY.trim() === '') {
      return;
    }
    setSearching(true);
    setError('');
    try {
      const suggestion = new TMap.service.Suggestion({ pageSize: 10 });
      const result = await suggestion.getSuggestions({
        keyword: keyword.trim(),
        region: '深圳',
        region_fix: 1,
        page_size: 10,
      });
      setSuggestions(result.data ?? []);
    } catch {
      setError('地址搜索失败，请检查地图 Key 与域名白名单');
    } finally {
      setSearching(false);
    }
  };

  const chooseSuggestion = (suggestion: TMapSuggestionResult): void => {
    const location = suggestion.location;
    if (location === undefined) {
      return;
    }
    const next = { lat: location.lat, lng: location.lng };
    setSelected(next);
    setPickedAddress(suggestion.address ?? suggestion.title ?? '');
    mapRef.current?.setCenter(new TMap.LatLng(next.lat, next.lng));
    markerRef.current?.setGeometries([
      { id: 'picked', position: new TMap.LatLng(next.lat, next.lng) },
    ]);
    setSuggestions([]);
  };

  const confirm = (): void => {
    if (selected === null) {
      return;
    }
    onPick({
      latitude: selected.lat.toFixed(6),
      longitude: selected.lng.toFixed(6),
      address: updateAddress && pickedAddress !== '' ? pickedAddress : null,
    });
    onClose();
  };

  return (
    <Modal
      title="地图选点"
      open={open}
      onCancel={onClose}
      onOk={confirm}
      okText="使用这个位置"
      cancelText="取消"
      width={760}
      okButtonProps={{ disabled: selected === null }}
      destroyOnHidden
    >
      {MAP_JS_KEY.trim() === '' ? (
        <Alert
          type="warning"
          showIcon
          message="未配置腾讯地图 JS Key"
          description="构建 admin 时设置 NEXT_PUBLIC_TENCENT_MAP_JS_KEY，并在腾讯位置服务控制台把 fish-admin.unihuan.com 加入域名白名单。"
        />
      ) : (
        <>
          <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
            <Input
              value={keyword}
              placeholder="搜索地址，例如 深圳湾公园"
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() => {
                void searchAddress();
              }}
            />
            <Button loading={searching} onClick={() => void searchAddress()}>
              搜索
            </Button>
          </Space.Compact>
          {suggestions.length > 0 && (
            <List
              className="map-suggestions"
              size="small"
              dataSource={suggestions}
              renderItem={(item) => (
                <List.Item
                  className="map-suggestion-item"
                  onClick={() => chooseSuggestion(item)}
                >
                  <List.Item.Meta
                    title={item.title ?? item.address ?? '未命名地点'}
                    description={item.address ?? ''}
                  />
                </List.Item>
              )}
            />
          )}
          {error !== '' && (
            <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
          )}
          <div ref={containerRef} className="map-picker-canvas" />
          <div className="map-picker-meta">
            <Typography.Text type="secondary">
              {selected === null
                ? '点击地图选择位置'
                : `已选：${selected.lat.toFixed(6)}, ${selected.lng.toFixed(6)}`}
            </Typography.Text>
            {pickedAddress !== '' && (
              <Typography.Text type="secondary">{pickedAddress}</Typography.Text>
            )}
            {loading && <Typography.Text type="secondary">地图加载中…</Typography.Text>}
          </div>
          <Checkbox
            checked={updateAddress}
            onChange={(event) => setUpdateAddress(event.target.checked)}
          >
            同时用地图地址覆盖钓点地址
          </Checkbox>
        </>
      )}
    </Modal>
  );
}
