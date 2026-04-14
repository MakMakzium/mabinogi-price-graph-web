import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import './App.css';

ChartJS.register(
  CategoryScale, LinearScale, LogarithmicScale,
  BarElement, PointElement, LineElement,
  Title, Tooltip, Legend,
);

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

const COLOR_OPTION_TYPES = new Set(['아이템 색상', '색상']);
const isColorType = (t: string) => COLOR_OPTION_TYPES.has(t);

// 아이템 이름 없이 검색 가능한 타입 (카테고리 전체 조회 또는 고정 아이템명 자동 사용)
const EMPTY_SEARCH_ALLOWED = new Set([
  '인챈트 종류', '색상', '무리아스 유물',
  '에코스톤 각성 능력', '에코스톤 고유 능력', '에코스톤 등급',
  '토템 효과', '토템 추가 옵션', '토템 강화 제한',
  '펫 정보',
]);

// 아이템 하나에 동일 타입이 여러 슬롯으로 붙는 옵션 타입
const SLOT_TYPED_OPTIONS = new Set([
  '세공 옵션', '무리아스 유물', '에코스톤 각성 능력',
  '사용 효과', '세트 효과', '조미료 효과',
]);
const isSlotTyped = (t: string) => SLOT_TYPED_OPTIONS.has(t);

// 슬롯이 1개만 필요한 타입 (option_value 텍스트 앞부분 = 그래프 X축 기준)
// ex) 무리아스 유물: "파이어 리프 어택 대미지 400%..." → 필드 1개로 스탯명 입력
const SINGLE_SLOT_OPTIONS = new Set(['무리아스 유물']);

// 슬롯 외에 별도 "효과" 필드가 필요한 타입
// 값: 해당 효과 목록을 조회할 option_type 이름
const EFFECT_FIELD_TYPES: Record<string, string> = {};

// ── 유틸리티 ──────────────────────────────────────────────────────────────────

const hexToRgbString = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};

const rgbStringToHex = (rgb: string) => {
  const n = rgb.match(/\d+/g);
  if (!n || n.length < 3) return '#000000';
  return `#${Number(n[0]).toString(16).padStart(2,'0')}${Number(n[1]).toString(16).padStart(2,'0')}${Number(n[2]).toString(16).padStart(2,'0')}`;
};

const fmt = (p: number) => p.toLocaleString('ko-KR') + 'G';

// ── 타입 ──────────────────────────────────────────────────────────────────────

type Theme      = 'dark' | 'light' | 'simple';
type OptionsMap = { [type: string]: string[] };
type ColorView  = 'carousel' | 'inline' | 'swatch' | 'bar';
type SortDir    = 'asc' | 'desc';

interface AndCondition { type: string; subType: string; value: string; }
interface ColorEntry   { r: number; g: number; b: number; hex: string; price: number; }

interface ItemOption   { type: string; sub_type: string; value: string; value2: string; }
interface ItemDetail   { item_name: string; price: number; auction_end_date: string; options: ItemOption[]; }
interface DetailModal  { value: string; items: ItemDetail[]; }

interface LastSearch   { optionId: string; searchParam: Record<string, string | undefined>; andStr: string; }

const THEME_ICONS:  Record<Theme, string> = { light: '☀️', dark: '🌙', simple: '⭐' };
const THEME_TITLES: Record<Theme, string> = { light: '라이트', dark: '다크', simple: '심플' };

// 옵션 타입 그룹핑 (순서 = 드롭다운 표시 순서)
// 목록에 없는 타입은 자동으로 '기타' 그룹에 들어감
const OPTION_TYPE_GROUPS: { label: string; types: string[] }[] = [
  {
    label: '장비 스탯',
    types: ['공격', '방어력', '마법 방어력', '보호', '마법 보호', '밸런스', '부상률', '크리티컬', '피어싱 레벨'],
  },
  {
    label: '강화/개조',
    types: ['세공 옵션', '에르그', '일반 개조', '보석 개조', '특별 개조', '장인 개조'],
  },
  {
    label: '인챈트',
    types: ['인챈트', '인챈트 종류', '인챈트 불가능'],
  },
  {
    label: '색상',
    types: ['색상', '아이템 색상'],
  },
  {
    label: '세트/효과',
    types: ['사용 효과', '세트 효과'],
  },
  {
    label: '아이템 정보',
    types: ['내구도', '내구력', '숙련', '품질', '크기', '아이템 보호'],
  },
  {
    label: '거래/제한',
    types: ['남은 거래 횟수', '남은 사용 횟수', '남은 전용 해제 가능 횟수', '전용 해제 거래 보증서 사용 불가'],
  },
  {
    label: '에코스톤',
    types: ['에코스톤 각성 능력', '에코스톤 고유 능력', '에코스톤 등급'],
  },
  {
    label: '토템',
    types: ['토템 효과', '토템 추가 옵션', '토템 강화 제한'],
  },
  {
    label: '유물',
    types: ['무리아스 유물'],
  },
  {
    label: '음식/허브',
    types: ['조미료 효과'],
  },
  {
    label: '펫',
    types: ['펫 정보'],
  },
];

// ── 콤보박스 컴포넌트 ──────────────────────────────────────────────────────────

const ComboboxInput = ({
  value, onChange, suggestions, placeholder, disabled, loading,
  onFocus: onFocusProp, onBlur: onBlurProp, onKeyDown: onKeyDownProp,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) => {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!value) return suggestions;
    const q = value.toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(q));
  }, [value, suggestions]);

  return (
    <div className="combobox-wrap">
      <input
        type="text"
        className={`combobox-input${loading ? ' loading' : ''}`}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); onFocusProp?.(); }}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onBlurProp?.(); }}
        onKeyDown={onKeyDownProp}
        placeholder={loading ? '불러오는 중…' : placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && !disabled && filtered.length > 0 && (
        <ul className="combobox-dropdown">
          {filtered.slice(0, 40).map(s => (
            <li
              key={s}
              className={s === value ? 'selected' : ''}
              onMouseDown={() => { onChange(s); setOpen(false); }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('mabi-theme') as Theme) || 'light'
  );

  const [options,        setOptions]        = useState<OptionsMap>({});
  const [optionsLoading, setOptionsLoading] = useState(true);

  // 슬롯 타입 서브옵션 (Nexon API 라이브 조회 결과)
  const [slotStats,   setSlotStats]   = useState<Record<string, string[]>>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  const [searchMode,        setSearchMode]        = useState<'name' | 'category'>('name');
  const [categories,        setCategories]        = useState<string[]>([]);
  const [selectedCategory,  setSelectedCategory]  = useState('');
  const [itemName,          setItemName]          = useState('');
  const [itemSuggestions,   setItemSuggestions]   = useState<string[]>([]);
  const [itemSearchLoading, setItemSearchLoading] = useState(false);
  const [primaryGroup,   setPrimaryGroup]   = useState('');
  const [primaryType,    setPrimaryType]    = useState('');
  const [primarySubType, setPrimarySubType] = useState('');
  const [primarySlots,   setPrimarySlots]   = useState<[string, string, string]>(['', '', '']);
  const [primaryEffect,  setPrimaryEffect]  = useState('');
  const [focusedSlot,    setFocusedSlot]    = useState<number | null>(null);
  const [effectFocused,  setEffectFocused]  = useState(false);
  const [andConditions,  setAndConditions]  = useState<AndCondition[]>([]);

  const [chartData,       setChartData]       = useState<any>(null);
  const [colorData,       setColorData]       = useState<ColorEntry[] | null>(null);
  const [categoricalData, setCategoricalData] = useState<{ labels: string[]; data: number[] } | null>(null);
  const [resultLabel,     setResultLabel]     = useState('');

  const [catSearch,        setCatSearch]        = useState('');
  const [catPage,          setCatPage]          = useState(1);
  const [catPageSize,      setCatPageSize]      = useState(20);
  const [catSortDir,       setCatSortDir]       = useState<SortDir>('asc');

  const [colorView,        setColorView]        = useState<ColorView>('carousel');
  const [sortDir,          setSortDir]          = useState<SortDir>('asc');
  const [inlinePage,       setInlinePage]       = useState(1);
  const [inlinePageSize,   setInlinePageSize]   = useState(20);
  const [inlineItemsPerRow, setInlineItemsPerRow] = useState(8);
  const [searchHex,  setSearchHex] = useState('#000000');

  const carouselRef = useRef<HTMLDivElement>(null);
  const cardRefs    = useRef<(HTMLDivElement | null)[]>([]);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [lastSearch,    setLastSearch]    = useState<LastSearch | null>(null);
  const [detailModal,   setDetailModal]   = useState<DetailModal | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scanned,       setScanned]       = useState<number | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const optionTypes = Object.keys(options).sort();

  const filteredOptionTypes = useMemo(() => {
    if (!primaryGroup) return optionTypes;
    const groupTypes = new Set(
      OPTION_TYPE_GROUPS.find(g => g.label === primaryGroup)?.types ?? []
    );
    return optionTypes.filter(t => groupTypes.has(t));
  }, [primaryGroup, optionTypes]); // eslint-disable-line

  // ── 테마 ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mabi-theme', theme);
  }, [theme]);

  // ── 아이템 이름 자동완성 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!itemName.trim() || itemName.trim().length < 2) {
      setItemSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      setItemSearchLoading(true);
      axios.get(`${API_BASE_URL}/search-items`, { params: { keyword: itemName.trim() } })
        .then(res => setItemSuggestions(res.data.names || []))
        .catch(() => setItemSuggestions([]))
        .finally(() => setItemSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [itemName]); // eslint-disable-line

  // ── 옵션 로드 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API_BASE_URL}/options`)
      .then(res => {
        const data: OptionsMap = res.data;
        setOptions(data);
      })
      .catch(() => setError('백엔드 서버에서 옵션 목록을 가져올 수 없습니다.'))
      .finally(() => setOptionsLoading(false));
  }, []);

  // ── 카테고리 로드 ──────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API_BASE_URL}/categories`)
      .then(res => {
        setCategories(res.data || []);
        if (res.data?.length > 0) setSelectedCategory(res.data[0]);
      })
      .catch(() => {});
  }, []);

  // ── 슬롯 타입 서브옵션 조회 ────────────────────────────────────────────────
  const fetchSlotStats = (optionType: string) => {
    if (!optionType) return;
    if (slotStats[optionType] !== undefined) return;
    if (fetchingRef.current.has(optionType)) return;
    fetchingRef.current.add(optionType);

    axios.get(`${API_BASE_URL}/sub-options`, { params: { option_type: optionType } })
      .then(res => setSlotStats(prev => ({ ...prev, [optionType]: res.data.stats || [] })))
      .catch(() => setSlotStats(prev => ({ ...prev, [optionType]: [] })))
      .finally(() => fetchingRef.current.delete(optionType));
  };

  useEffect(() => {
    if (isSlotTyped(primaryType)) fetchSlotStats(primaryType);
  }, [primaryType]); // eslint-disable-line

  useEffect(() => {
    andConditions.forEach(c => {
      if (isSlotTyped(c.type)) fetchSlotStats(c.type);
    });
  }, [andConditions]); // eslint-disable-line

  // ── 차트 테마 ───────────────────────────────────────────────────────────────
  const chartColors = useMemo(() => {
    if (theme === 'light')   return { text: '#1a2235', grid: 'rgba(0,0,0,0.07)',        ticks: '#4b5a6e' };
    if (theme === 'simple')  return { text: '#3d1f00', grid: 'rgba(180,80,0,0.08)',     ticks: '#8b5a2b' };
    return                          { text: '#c8d0e0', grid: 'rgba(255,255,255,0.07)',  ticks: '#7d8ba5' };
  }, [theme]);

  // ── 핸들러 ────────────────────────────────────────────────────────────────

  const handlePrimaryTypeChange = (t: string) => {
    setPrimaryType(t);
    setPrimarySubType((options[t] || [])[0] ?? '');
    setPrimarySlots(['', '', '']);
    setPrimaryEffect('');
    setFocusedSlot(null);
    setEffectFocused(false);
  };

  const handlePrimaryGroupChange = (group: string) => {
    setPrimaryGroup(group);
    if (group) {
      const groupTypes = (OPTION_TYPE_GROUPS.find(g => g.label === group)?.types ?? [])
        .filter(t => optionTypes.includes(t));
      handlePrimaryTypeChange(groupTypes[0] ?? '');
    }
  };

  const updatePrimarySlot = (i: 0 | 1 | 2, v: string) => {
    const s = [...primarySlots] as [string, string, string];
    s[i] = v;
    setPrimarySlots(s);
  };

  const addAndCondition = () => {
    if (andConditions.length >= 2) return;
    const t = optionTypes[0] ?? '';
    setAndConditions([...andConditions, {
      type: t,
      subType: isSlotTyped(t) ? '' : ((options[t] || [])[0] ?? ''),
      value: isColorType(t) ? '0,0,0' : '',
    }]);
  };

  const removeAndCondition = (i: number) =>
    setAndConditions(andConditions.filter((_, idx) => idx !== i));

  const updateAndCond = (i: number, field: 'type' | 'subType', val: string) => {
    const upd = [...andConditions];
    if (field === 'type') {
      upd[i] = {
        type: val,
        subType: isSlotTyped(val) ? '' : ((options[val] || [])[0] ?? ''),
        value: isColorType(val) ? '0,0,0' : '',
      };
    } else {
      upd[i] = { ...upd[i], subType: val };
    }
    setAndConditions(upd);
  };

  const updateAndColor = (i: number, rgb: string) => {
    const upd = [...andConditions];
    upd[i] = { ...upd[i], value: rgb };
    setAndConditions(upd);
  };

  const buildId = (type: string, sub: string) => sub ? `${type}|${sub}` : type;

  const handleFetch = () => {
    if (searchMode === 'category') {
      if (!selectedCategory) { setError('카테고리를 선택해주세요.'); return; }
    } else {
      if (!itemName.trim() && !EMPTY_SEARCH_ALLOWED.has(primaryType)) {
        setError('아이템 이름을 입력해주세요.'); return;
      }
    }
    if (!primaryType) { setError('그래프 기준 옵션을 선택해주세요.'); return; }

    const slotBased = isSlotTyped(primaryType);

    setLoading(true);
    setError(null);
    setChartData(null);
    setColorData(null);
    setCategoricalData(null);
    setDetailModal(null);

    let optionId: string;
    let slotAnds: AndCondition[] = [];

    if (slotBased) {
      // 채워진 슬롯 순서대로 수집: 첫 번째 = 그래프 기준, 나머지 = AND 조건
      const filled = primarySlots.map(s => s.trim()).filter(Boolean);
      optionId = buildId(primaryType, filled[0] ?? '');
      slotAnds = filled.slice(1).map(s => ({ type: primaryType, subType: s, value: '' }));
    } else {
      optionId = buildId(primaryType, primarySubType);
    }

    const effectAnd: AndCondition[] =
      (primaryEffect.trim() && primaryType in EFFECT_FIELD_TYPES)
        ? [{ type: EFFECT_FIELD_TYPES[primaryType], subType: primaryEffect.trim(), value: '' }]
        : [];

    const allAnds = [...slotAnds, ...effectAnd, ...andConditions.filter(c => c.type)];

    const andStr = allAnds
      .map(c => {
        const id = buildId(c.type, c.subType);
        return isColorType(c.type) && c.value ? `${id}|${c.value}` : id;
      })
      .join(';');

    const condLabel = [
      optionId,
      ...allAnds.map(c => {
        const id = buildId(c.type, c.subType);
        return isColorType(c.type) && c.value ? `${id}=(${c.value})` : id;
      }),
    ].join(' + ');

    const searchParam = searchMode === 'category'
      ? { category: selectedCategory }
      : { item_name: itemName.trim() };

    const displayName = searchMode === 'category'
      ? `[${selectedCategory}]`
      : (itemName.trim() || '(전체)');

    setLastSearch({ optionId, searchParam: searchParam as Record<string, string | undefined>, andStr });
    setScanned(null);

    // 이전 스트림 정리
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const rawParams: Record<string, string> = { option_id: optionId };
    Object.entries(searchParam).forEach(([k, v]) => { if (v != null) rawParams[k] = v; });
    if (andStr) rawParams['and_options'] = andStr;
    const params = new URLSearchParams(rawParams);
    const es = new EventSource(`${API_BASE_URL}/graph-data-stream?${params}`);
    esRef.current = es;

    const applyData = (res: any, label: string) => {
      if (res.type === 'color') {
        setColorData(res.colors);
      } else if (res.type === 'categorical') {
        setCategoricalData({ labels: res.labels, data: res.data });
      } else {
        setChartData({
          labels: res.labels,
          datasets: [{
            label: `${label} 최저가`,
            data: res.data,
            borderColor: 'rgb(97, 218, 251)',
            backgroundColor: 'rgba(97, 218, 251, 0.12)',
            pointBackgroundColor: 'rgb(97, 218, 251)',
            pointRadius: 4,
            tension: 0.3,
          }],
        });
      }
    };

    es.onmessage = (e) => {
      const res = JSON.parse(e.data);
      if (res.error) {
        setError(res.error);
        es.close(); esRef.current = null;
        setLoading(false);
        return;
      }
      const label = `${res.item_name || displayName} / ${condLabel}`;
      setResultLabel(label);
      if (res.scanned != null) setScanned(res.scanned);
      applyData(res, label);
      if (res.done) {
        es.close(); esRef.current = null;
        setLoading(false);
      }
    };

    es.onerror = () => {
      setError('데이터를 가져오는 중 오류가 발생했습니다. 아이템 이름이 정확한지 확인해주세요.');
      es.close(); esRef.current = null;
      setLoading(false);
    };
  };

  // ── 매물 상세 조회 ─────────────────────────────────────────────────────────

  const fetchItemDetails = useCallback((value: string, search: LastSearch) => {
    setDetailLoading(true);
    setDetailModal({ value, items: [] });

    axios.get(`${API_BASE_URL}/item-list`, {
      params: {
        option_id: search.optionId,
        ...search.searchParam,
        ...(search.andStr && { and_options: search.andStr }),
        value,
      },
    })
      .then(res => {
        if (res.data.error) setDetailModal(null);
        else setDetailModal({ value, items: res.data.items || [] });
      })
      .catch(() => setDetailModal(null))
      .finally(() => setDetailLoading(false));
  }, []); // eslint-disable-line

  const handleNumericClick = useCallback((_: any, elements: any[]) => {
    if (!elements.length || !chartData || !lastSearch) return;
    const value = String(chartData.labels[elements[0].index]);
    fetchItemDetails(value, lastSearch);
  }, [chartData, lastSearch, fetchItemDetails]);

  const handleCategoricalClick = useCallback((_: any, elements: any[]) => {
    if (!elements.length || !categoricalData || !lastSearch) return;
    const value = categoricalData.labels[elements[0].index];
    fetchItemDetails(value, lastSearch);
  }, [categoricalData, lastSearch, fetchItemDetails]);

  // ── 색상 정렬 ──────────────────────────────────────────────────────────────
  const sortedColors = useMemo(() =>
    colorData
      ? [...colorData].sort((a, b) => sortDir === 'asc' ? a.price - b.price : b.price - a.price)
      : []
  , [colorData, sortDir]);

  // 새 categorical 결과가 올 때 초기화
  useEffect(() => { setCatSearch(''); setCatPage(1); }, [categoricalData]);

  // 새 색상 결과가 올 때 퀵서치·페이지 초기화
  useEffect(() => { setSearchHex('#000000'); cardRefs.current = []; setInlinePage(1); }, [colorData]);
  useEffect(() => { setInlinePage(1); }, [sortDir, inlinePageSize, inlineItemsPerRow]);

  // 퀵서치: 입력 색상과 가장 가까운 색상 인덱스 (유클리드 거리)
  const matchedIdx = useMemo(() => {
    if (!/^#[0-9a-fA-F]{6}$/.test(searchHex) || sortedColors.length === 0) return null;
    const r = parseInt(searchHex.slice(1, 3), 16);
    const g = parseInt(searchHex.slice(3, 5), 16);
    const b = parseInt(searchHex.slice(5, 7), 16);
    let minDist = Infinity, minIdx = 0;
    sortedColors.forEach((c, i) => {
      const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
      if (d < minDist) { minDist = d; minIdx = i; }
    });
    return minIdx;
  }, [searchHex, sortedColors]);

  // matchedIdx가 바뀌면 해당 카드로 캐러셀 스크롤
  useEffect(() => {
    if (matchedIdx === null || !carouselRef.current) return;
    const card = cardRefs.current[matchedIdx];
    if (!card) return;
    const container = carouselRef.current;
    const left = card.offsetLeft - (container.offsetWidth - card.offsetWidth) / 2;
    container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [matchedIdx]);

  // ── 인라인 페이지네이션 ───────────────────────────────────────────────────
  const totalPages  = Math.max(1, Math.ceil(sortedColors.length / inlinePageSize));
  const pagedColors = sortedColors.slice((inlinePage - 1) * inlinePageSize, inlinePage * inlinePageSize);

  const colorBarData = sortedColors.length > 0 ? {
    labels: sortedColors.map(e => `(${e.r},${e.g},${e.b})`),
    datasets: [{
      label: '최저가',
      data: sortedColors.map(e => e.price),
      backgroundColor: sortedColors.map(e => e.hex),
      borderColor:     sortedColors.map(e => e.hex),
      borderWidth: 1,
    }],
  } : null;

  // ── 캐러셀 버튼 ──────────────────────────────────────────────────────────
  const scrollCarousel = (dir: 'prev' | 'next') => {
    if (!carouselRef.current) return;
    const amount = carouselRef.current.offsetWidth * 0.8;
    carouselRef.current.scrollBy({ left: dir === 'next' ? amount : -amount, behavior: 'smooth' });
  };

  // ── 차트 옵션 ─────────────────────────────────────────────────────────────
  const lineOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' as const, labels: { color: chartColors.text } },
      title:  { display: true, text: `${resultLabel} 최저가 — 점을 클릭하면 매물 목록을 볼 수 있습니다`, color: chartColors.text },
    },
    scales: {
      x: { ticks: { color: chartColors.ticks }, grid: { color: chartColors.grid } },
      y: {
        ticks: { color: chartColors.ticks, callback: (v: any) => fmt(Number(v)) },
        grid:  { color: chartColors.grid },
      },
    },
    onClick: handleNumericClick,
    onHover: (_: any, elements: any[], chart: any) => {
      if (chart?.canvas) chart.canvas.style.cursor = elements.length ? 'pointer' : 'default';
    },
  };

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title:  { display: true, text: `${resultLabel} — 색상별 최저가 (로그 스케일)`, color: chartColors.text },
      tooltip: { callbacks: { label: (ctx: any) => fmt(ctx.parsed.y) } },
    },
    scales: {
      x: { ticks: { color: chartColors.ticks }, grid: { color: chartColors.grid } },
      y: {
        type: 'logarithmic' as const,
        ticks: {
          color: chartColors.ticks,
          callback: (v: any) => {
            const n = Number(v);
            const log = Math.log10(n);
            if (Math.abs(log - Math.round(log)) < 0.001) return fmt(n);
            return '';
          },
        },
        grid: { color: chartColors.grid },
      },
    },
  };

  // ── categorical 필터/정렬/페이지 ─────────────────────────────────────────
  const catFiltered = useMemo(() => {
    if (!categoricalData) return [];
    const q = catSearch.trim().toLowerCase();
    const pairs = categoricalData.labels.map((label, i) => ({ label, price: categoricalData.data[i] }));
    const filtered = q ? pairs.filter(p => p.label.toLowerCase().includes(q)) : pairs;
    return [...filtered].sort((a, b) =>
      catSortDir === 'asc' ? a.price - b.price : b.price - a.price
    );
  }, [categoricalData, catSearch, catSortDir]);

  const catTotalPages = Math.max(1, Math.ceil(catFiltered.length / catPageSize));
  const catPaged      = catFiltered.slice((catPage - 1) * catPageSize, catPage * catPageSize);

  useEffect(() => { setCatPage(1); }, [catSearch, catSortDir, catPageSize]);

  const categoricalOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title:  { display: true, text: `${resultLabel} — 인챈트별 최저가 — 막대를 클릭하면 매물 목록을 볼 수 있습니다`, color: chartColors.text },
      tooltip: { callbacks: { label: (ctx: any) => fmt(ctx.parsed.y) } },
    },
    scales: {
      x: {
        ticks: {
          color: chartColors.ticks,
          maxRotation: 60,
          minRotation: 30,
          autoSkip: false,
        },
        grid: { color: chartColors.grid },
      },
      y: {
        ticks: { color: chartColors.ticks, callback: (v: any) => fmt(Number(v)) },
        grid:  { color: chartColors.grid },
      },
    },
    onClick: handleCategoricalClick,
    onHover: (_: any, elements: any[], chart: any) => {
      if (chart?.canvas) chart.canvas.style.cursor = elements.length ? 'pointer' : 'default';
    },
  };

  // ── 옵션 타입 그룹 렌더 ───────────────────────────────────────────────────
  const renderOptionTypeGroups = (availableTypes: string[]) => {
    const typeSet  = new Set(availableTypes);
    const assigned = new Set<string>();

    const groups = OPTION_TYPE_GROUPS
      .map(g => ({ label: g.label, types: g.types.filter(t => typeSet.has(t)) }))
      .filter(g => g.types.length > 0);

    groups.forEach(g => g.types.forEach(t => assigned.add(t)));

    const rest = availableTypes.filter(t => !assigned.has(t));

    return (
      <>
        {groups.map(g => (
          <optgroup key={g.label} label={g.label}>
            {g.types.map(t => <option key={t} value={t}>{t}</option>)}
          </optgroup>
        ))}
        {rest.length > 0 && (
          <optgroup label="기타">
            {rest.map(t => <option key={t} value={t}>{t}</option>)}
          </optgroup>
        )}
      </>
    );
  };

  // ── 서브컴포넌트 ──────────────────────────────────────────────────────────
  const SubTypeSelect = ({ type, subType, onChange, disabled }: {
    type: string; subType: string;
    onChange: (v: string) => void; disabled?: boolean;
  }) => {
    const subs = options[type] || [];
    if (subs.length === 0) return null;
    return (
      <select value={subType} onChange={e => onChange(e.target.value)} disabled={disabled || optionsLoading}>
        {subs.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  };

  // 슬롯 타입 콤보박스 suggestions: 라이브 조회 결과 우선, 없으면 정적 옵션
  const getSlotSuggestions = (t: string) =>
    (slotStats[t] && slotStats[t].length > 0) ? slotStats[t] : (options[t] || []);
  const isSlotLoading = (t: string) =>
    fetchingRef.current.has(t) && !slotStats[t];

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <h1>마비노기 아이템 옵션별 가격 그래프</h1>
          <p>아이템의 특정 옵션 수치에 따른 경매장 최저가 변화를 확인합니다.</p>
        </div>
        <div className="theme-toggle">
          {(['light', 'dark', 'simple'] as Theme[]).map(t => (
            <button
              key={t}
              className={theme === t ? 'active' : ''}
              onClick={() => setTheme(t)}
              title={THEME_TITLES[t]}
            >
              {THEME_ICONS[t]}
            </button>
          ))}
        </div>
      </header>

      <main className="App-main">
        {/* 검색 */}
        <div className="search-row">
          <div className="search-mode-group btn-group">
            <button
              className={searchMode === 'name' ? 'active' : ''}
              onClick={() => setSearchMode('name')}
            >이름</button>
            <button
              className={searchMode === 'category' ? 'active' : ''}
              onClick={() => setSearchMode('category')}
            >카테고리</button>
          </div>

          {searchMode === 'name' ? (
            <ComboboxInput
              value={itemName}
              onChange={setItemName}
              suggestions={itemSuggestions}
              placeholder={
                EMPTY_SEARCH_ALLOWED.has(primaryType)
                  ? '아이템 이름 입력 (비워두면 전체 검색)'
                  : '아이템 이름 입력 (예: 나이트브링어 인퀴지터)'
              }
              loading={itemSearchLoading}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
          ) : (
            <select
              className="category-select"
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
            >
              {categories.length === 0 && <option value="">불러오는 중…</option>}
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          <button className="btn-primary" onClick={handleFetch} disabled={loading || optionsLoading}>
            {loading
              ? scanned != null ? `스캔 중… ${scanned.toLocaleString()}건` : '불러오는 중…'
              : '그래프 생성'}
          </button>
        </div>

        {/* 옵션 선택 */}
        <div className="option-section">

          {/* 기준 옵션 타입 선택 */}
          <div className="option-row primary-row">
            <span className="option-label">그래프 기준</span>
            <div className="option-selects">
              <select value={primaryGroup} onChange={e => handlePrimaryGroupChange(e.target.value)} disabled={optionsLoading}>
                <option value="">전체</option>
                {OPTION_TYPE_GROUPS
                  .filter(g => g.types.some(t => optionTypes.includes(t)))
                  .map(g => <option key={g.label} value={g.label}>{g.label}</option>)
                }
              </select>
              <select value={primaryType} onChange={e => handlePrimaryTypeChange(e.target.value)} disabled={optionsLoading}>
                <option value="">선택</option>
                {filteredOptionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {/* 일반 타입: 서브타입 드롭다운 */}
              {!isSlotTyped(primaryType) && (
                <SubTypeSelect type={primaryType} subType={primarySubType} onChange={setPrimarySubType} />
              )}
            </div>
          </div>

          {/* 슬롯 타입: 콤보박스 (단일 슬롯 타입은 1개, 그 외 3개) */}
          {isSlotTyped(primaryType) && (
            <div className="slot-section">
              {(SINGLE_SLOT_OPTIONS.has(primaryType) ? [0 as const] : [0, 1, 2] as const).map(i => (
                <div key={i} className="slot-row">
                  <span className={`slot-label${focusedSlot === i ? ' slot-label-primary' : ''}`}>
                    {SINGLE_SLOT_OPTIONS.has(primaryType)
                      ? `스탯${focusedSlot === i ? ' ★' : ''}`
                      : `슬롯 ${i + 1}${focusedSlot === i ? ' ★' : ''}`}
                  </span>
                  <ComboboxInput
                    value={primarySlots[i]}
                    onChange={v => updatePrimarySlot(i, v)}
                    suggestions={getSlotSuggestions(primaryType)}
                    placeholder="스탯 입력"
                    disabled={optionsLoading}
                    loading={i === 0 && isSlotLoading(primaryType)}
                    onFocus={() => setFocusedSlot(i)}
                    onBlur={() => setFocusedSlot(null)}
                  />
                  <span className="slot-hint">{i === 0 ? '→ X축' : '→ AND'}</span>
                </div>
              ))}

              {/* 효과 필드 (별도 효과 조건이 있는 타입에만 표시) */}
              {!SINGLE_SLOT_OPTIONS.has(primaryType) && primaryType in EFFECT_FIELD_TYPES && (
                <div className="slot-row slot-row-effect">
                  <span className={`slot-label${effectFocused ? ' slot-label-primary' : ''}`}>
                    효과{effectFocused ? ' ★' : ''}
                  </span>
                  <ComboboxInput
                    value={primaryEffect}
                    onChange={setPrimaryEffect}
                    suggestions={getSlotSuggestions(EFFECT_FIELD_TYPES[primaryType])}
                    placeholder="효과 입력"
                    disabled={optionsLoading}
                    loading={isSlotLoading(EFFECT_FIELD_TYPES[primaryType])}
                    onFocus={() => setEffectFocused(true)}
                    onBlur={() => setEffectFocused(false)}
                  />
                  <span className="slot-hint">→ AND</span>
                </div>
              )}
            </div>
          )}

          {/* AND 조건 */}
          {andConditions.map((cond, i) => (
            <div key={i} className="option-row and-row">
              <span className="option-label and-label">AND</span>
              <div className="option-selects">
                <select value={cond.type} onChange={e => updateAndCond(i, 'type', e.target.value)} disabled={optionsLoading}>
                  {renderOptionTypeGroups(optionTypes)}
                </select>

                {isSlotTyped(cond.type) ? (
                  <ComboboxInput
                    value={cond.subType}
                    onChange={v => updateAndCond(i, 'subType', v)}
                    suggestions={getSlotSuggestions(cond.type)}
                    placeholder="스탯 입력"
                    disabled={optionsLoading}
                    loading={isSlotLoading(cond.type)}
                  />
                ) : (
                  <SubTypeSelect type={cond.type} subType={cond.subType} onChange={v => updateAndCond(i, 'subType', v)} />
                )}

                {isColorType(cond.type) && (
                  <div className="color-picker-inline">
                    <input
                      type="color"
                      value={rgbStringToHex(cond.value || '0,0,0')}
                      onChange={e => updateAndColor(i, hexToRgbString(e.target.value))}
                      title="색상 선택"
                    />
                    <span className="color-rgb-label">({cond.value || '0,0,0'})</span>
                  </div>
                )}
              </div>
              <button className="btn-remove" onClick={() => removeAndCondition(i)}>✕</button>
            </div>
          ))}

          {andConditions.length < 2 && (
            <button className="btn-add-condition" onClick={addAndCondition} disabled={optionsLoading}>
              + AND 조건 추가
            </button>
          )}
        </div>

        {/* 에러 */}
        {error && <div className="result-container"><p className="error-message">{error}</p></div>}

        {/* 수치 그래프 */}
        {chartData && (
          <div className="chart-container">
            <Line options={lineOptions} data={chartData} />
          </div>
        )}

        {/* 인챈트 등 카테고리형 그래프 */}
        {categoricalData && (
          <div className="chart-container">
            {/* 컨트롤 바 */}
            <div className="cat-controls">
              <span className="cat-result-title">{resultLabel}</span>
              <div className="cat-control-btns">
                <input
                  className="cat-search-input"
                  type="text"
                  placeholder="이름 검색…"
                  value={catSearch}
                  onChange={e => setCatSearch(e.target.value)}
                />
                <div className="btn-group">
                  <button className={catSortDir === 'asc'  ? 'active' : ''} onClick={() => setCatSortDir('asc')}>낮은순</button>
                  <button className={catSortDir === 'desc' ? 'active' : ''} onClick={() => setCatSortDir('desc')}>높은순</button>
                </div>
              </div>
            </div>

            {/* Bar 차트 — 현재 페이지 데이터만 */}
            {catPaged.length > 0 && (() => {
              const pageChartData = {
                labels: catPaged.map(p => p.label),
                datasets: [{
                  label: '최저가',
                  data: catPaged.map(p => p.price),
                  backgroundColor: 'rgba(97, 218, 251, 0.7)',
                  borderColor: 'rgb(97, 218, 251)',
                  borderWidth: 1,
                }],
              };
              const pageOptions = {
                ...categoricalOptions,
                onClick: (_: any, elements: any[]) => {
                  if (!elements.length || !lastSearch) return;
                  fetchItemDetails(catPaged[elements[0].index].label, lastSearch);
                },
              };
              return <Bar options={pageOptions} data={pageChartData} />;
            })()}

            {/* 페이지네이션 */}
            <div className="pagination cat-pagination">
              <button className="page-btn" onClick={() => setCatPage(p => Math.max(1, p - 1))} disabled={catPage === 1}>‹</button>
              <span className="page-info">
                {catPage} / {catTotalPages}
                <span className="page-total"> ({catFiltered.length}개)</span>
              </span>
              <button className="page-btn" onClick={() => setCatPage(p => Math.min(catTotalPages, p + 1))} disabled={catPage === catTotalPages}>›</button>
              <select className="page-size-select" value={catPageSize} onChange={e => setCatPageSize(Number(e.target.value))}>
                {[20, 50, 100].map(n => <option key={n} value={n}>{n}개씩</option>)}
              </select>
            </div>
          </div>
        )}

        {/* 색상 결과 */}
        {colorData && colorData.length > 0 && (
          <div className="chart-container">

            {/* 헤더: 타이틀 + 뷰 토글 + 정렬 */}
            <div className="color-controls">
              <span className="color-result-title">{resultLabel}</span>
              <div className="color-control-btns">
                <div className="btn-group">
                  <button className={colorView === 'carousel' ? 'active' : ''} onClick={() => setColorView('carousel')}>캐러셀</button>
                  <button className={colorView === 'inline'   ? 'active' : ''} onClick={() => setColorView('inline')}>인라인</button>
                  <button className={colorView === 'swatch'   ? 'active' : ''} onClick={() => setColorView('swatch')}>스와치</button>
                  <button className={colorView === 'bar'      ? 'active' : ''} onClick={() => setColorView('bar')}>그래프</button>
                </div>
                <div className="btn-group">
                  <button className={sortDir === 'asc'  ? 'active' : ''} onClick={() => setSortDir('asc')}>낮은순</button>
                  <button className={sortDir === 'desc' ? 'active' : ''} onClick={() => setSortDir('desc')}>높은순</button>
                </div>
              </div>
            </div>

            {/* 색상 퀵서치 (캐러셀·인라인 뷰에서 표시) */}
            {(colorView === 'carousel' || colorView === 'inline') && (
              <div className="color-quicksearch">
                <label className="qs-label">색상 검색</label>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(searchHex) ? searchHex : '#000000'}
                  onChange={e => setSearchHex(e.target.value)}
                />
                <input
                  type="text"
                  className="hex-input"
                  value={searchHex}
                  maxLength={7}
                  placeholder="#RRGGBB"
                  onChange={e => {
                    const v = e.target.value;
                    if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) setSearchHex(v.startsWith('#') ? v : '#' + v);
                  }}
                />
                {matchedIdx !== null && sortedColors[matchedIdx] && (
                  <div className="color-match-result">
                    <div className="color-match-swatch" style={{ backgroundColor: sortedColors[matchedIdx].hex }} />
                    <span className="color-match-hex">{sortedColors[matchedIdx].hex.toUpperCase()}</span>
                    <span className="color-match-rgb">({sortedColors[matchedIdx].r},{sortedColors[matchedIdx].g},{sortedColors[matchedIdx].b})</span>
                    <span className="color-match-price">{fmt(sortedColors[matchedIdx].price)}</span>
                  </div>
                )}
              </div>
            )}

            {/* 캐러셀 뷰 */}
            {colorView === 'carousel' && (
              <div className="color-carousel-wrap">
                <button className="carousel-btn" onClick={() => scrollCarousel('prev')}>‹</button>
                <div className="color-carousel" ref={carouselRef}>
                  {sortedColors.map((e, i) => (
                    <div
                      key={i}
                      className={`color-card${i === matchedIdx ? ' color-card-matched' : ''}`}
                      ref={el => { cardRefs.current[i] = el; }}
                    >
                      <div className="color-card-swatch" style={{ backgroundColor: e.hex }} />
                      <div className="color-card-info">
                        <span className="color-card-price">{fmt(e.price)}</span>
                        <span className="color-card-hex">{e.hex.toUpperCase()}</span>
                        <span className="color-card-rgb">({e.r},{e.g},{e.b})</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="carousel-btn" onClick={() => scrollCarousel('next')}>›</button>
              </div>
            )}

            {/* 인라인 뷰 */}
            {colorView === 'inline' && (
              <div className="inline-view">
                <div
                  className="inline-strip"
                  style={{ '--inline-cols': inlineItemsPerRow } as React.CSSProperties}
                >
                  {pagedColors.map((e, i) => (
                    <div key={i} className={`inline-item${sortedColors.indexOf(e) === matchedIdx ? ' color-card-matched' : ''}`}>
                      <div className="inline-color-bar" style={{ backgroundColor: e.hex }} />
                      <div className="inline-item-info">
                        <span className="inline-price">{fmt(e.price)}</span>
                        <span className="inline-hex">{e.hex.toUpperCase()}</span>
                        <span className="inline-rgb">({e.r},{e.g},{e.b})</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pagination">
                  <button className="page-btn" onClick={() => setInlinePage(p => Math.max(1, p - 1))} disabled={inlinePage === 1}>‹</button>
                  <span className="page-info">
                    {inlinePage} / {totalPages}
                    <span className="page-total"> ({sortedColors.length}개)</span>
                  </span>
                  <button className="page-btn" onClick={() => setInlinePage(p => Math.min(totalPages, p + 1))} disabled={inlinePage === totalPages}>›</button>
                  <select className="page-size-select" value={inlinePageSize} onChange={e => setInlinePageSize(Number(e.target.value))}>
                    {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}개씩</option>)}
                  </select>
                  <select className="page-size-select" value={inlineItemsPerRow} onChange={e => setInlineItemsPerRow(Number(e.target.value))}>
                    {[4, 5, 6, 8, 10, 12].map(n => <option key={n} value={n}>행당 {n}개</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* 스와치 뷰 */}
            {colorView === 'swatch' && (
              <div className="color-grid">
                {sortedColors.map((e, i) => (
                  <div key={i} className="color-swatch-card">
                    <div className="color-swatch-box" style={{ backgroundColor: e.hex }} />
                    <div className="color-swatch-info">
                      <span className="color-hex">{e.hex.toUpperCase()}</span>
                      <span className="color-rgb">({e.r}, {e.g}, {e.b})</span>
                      <span className="color-price">{fmt(e.price)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 바 차트 뷰 */}
            {colorView === 'bar' && colorBarData && (
              <Bar options={barOptions} data={colorBarData} />
            )}

          </div>
        )}
      </main>

      {/* ── 매물 상세 모달 ──────────────────────────────────────────────────── */}
      {detailModal && (
        <div className="detail-overlay" onClick={() => setDetailModal(null)}>
          <div className="detail-modal" onClick={e => e.stopPropagation()}>

            <div className="detail-modal-header">
              <h3>
                <span className="detail-modal-item">{resultLabel.split(' / ')[0]}</span>
                <span className="detail-modal-value"> — {detailModal.value}</span>
              </h3>
              <button className="detail-close-btn" onClick={() => setDetailModal(null)}>✕</button>
            </div>

            {detailLoading ? (
              <div className="detail-status">불러오는 중…</div>
            ) : detailModal.items.length === 0 ? (
              <div className="detail-status">매물을 찾을 수 없습니다.</div>
            ) : (
              <>
                <div className="detail-count">{detailModal.items.length}개 매물</div>
                <div className="detail-list">
                  {detailModal.items.map((item, i) => (
                    <div key={i} className="detail-item-card">
                      <div className="detail-item-head">
                        <span className="detail-item-name">{item.item_name}</span>
                        <span className="detail-item-price">{fmt(item.price)}</span>
                      </div>
                      <div className="detail-item-opts">
                        {item.options.map((opt, j) => {
                          const isReforge  = opt.type === '세공 옵션';
                          const isEnchant  = opt.type === '인챈트';
                          const isNumSub   = /^\d+$/.test(opt.sub_type ?? '');
                          const label = isReforge
                            ? opt.value
                            : isNumSub || !opt.sub_type
                              ? `${opt.type}: ${opt.value}`
                              : `${opt.type} (${opt.sub_type}): ${opt.value}`;
                          return (
                            <span
                              key={j}
                              className={`detail-opt-tag${isReforge ? ' tag-reforge' : isEnchant ? ' tag-enchant' : ''}`}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                      {item.auction_end_date && (
                        <div className="detail-item-expire">
                          만료: {new Date(item.auction_end_date).toLocaleString('ko-KR')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
