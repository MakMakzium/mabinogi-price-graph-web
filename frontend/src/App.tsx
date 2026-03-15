import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
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
  CategoryScale, LinearScale,
  BarElement, PointElement, LineElement,
  Title, Tooltip, Legend,
);

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

const COLOR_OPTION_TYPES = new Set(['아이템 색상', '색상']);
const isColorType = (t: string) => COLOR_OPTION_TYPES.has(t);

// 슬롯 번호(1/2/3)로 나뉘는 다중 인스턴스 옵션 타입
// 아이템 하나에 동일 타입이 여러 슬롯으로 붙을 수 있어 3개 필드로 입력
const SLOT_TYPED_OPTIONS = new Set([
  '세공 옵션',
  '무리아스의 유물',
  '사용 효과',
  '세트 효과',
  '조미료 효과',
]);
const isSlotTyped = (t: string) => SLOT_TYPED_OPTIONS.has(t);

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

const fmt = (p: number) => p.toLocaleString('ko-KR') + '원';

// ── 타입 ──────────────────────────────────────────────────────────────────────

type Theme      = 'dark' | 'light' | 'simple';
type OptionsMap = { [type: string]: string[] };
type ColorView  = 'swatch' | 'bar';
type SortDir    = 'asc' | 'desc';

interface AndCondition { type: string; subType: string; value: string; }
interface ColorEntry   { r: number; g: number; b: number; hex: string; price: number; }

const THEME_ICONS:  Record<Theme, string> = { light: '☀️', dark: '🌙', simple: '⭐' };
const THEME_TITLES: Record<Theme, string> = { light: '라이트', dark: '다크', simple: '심플' };

// ── 콤보박스 컴포넌트 ──────────────────────────────────────────────────────────

const ComboboxInput = ({
  value, onChange, suggestions, placeholder, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
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
        className="combobox-input"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && !disabled && filtered.length > 0 && (
        <ul className="combobox-dropdown">
          {filtered.slice(0, 30).map(s => (
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

  const [itemName,       setItemName]       = useState('');
  const [primaryType,    setPrimaryType]    = useState('');
  const [primarySubType, setPrimarySubType] = useState('');
  // 슬롯 타입용 3개 입력 필드 (인덱스 0 = 그래프 기준, 1·2 = AND 조건)
  const [primarySlots,   setPrimarySlots]   = useState<[string, string, string]>(['', '', '']);
  const [andConditions,  setAndConditions]  = useState<AndCondition[]>([]);

  const [chartData,   setChartData]   = useState<any>(null);
  const [colorData,   setColorData]   = useState<ColorEntry[] | null>(null);
  const [resultLabel, setResultLabel] = useState('');

  const [colorView, setColorView] = useState<ColorView>('swatch');
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const optionTypes = Object.keys(options).sort();

  // ── 테마 적용 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mabi-theme', theme);
  }, [theme]);

  // ── 옵션 로드 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API_BASE_URL}/options`)
      .then(res => {
        const data: OptionsMap = res.data;
        setOptions(data);
        const types = Object.keys(data).sort();
        if (types.length > 0) {
          setPrimaryType(types[0]);
          setPrimarySubType((data[types[0]] || [])[0] ?? '');
        }
      })
      .catch(() => setError('백엔드 서버에서 옵션 목록을 가져올 수 없습니다.'))
      .finally(() => setOptionsLoading(false));
  }, []);

  // ── 차트 테마 색상 ─────────────────────────────────────────────────────────
  const chartColors = useMemo(() => theme === 'dark'
    ? { text: '#c8d0e0', grid: 'rgba(255,255,255,0.07)', ticks: '#7d8ba5' }
    : { text: '#1a2235', grid: 'rgba(0,0,0,0.07)',       ticks: '#4b5a6e' }
  , [theme]);

  // ── 핸들러 ────────────────────────────────────────────────────────────────

  const handlePrimaryTypeChange = (t: string) => {
    setPrimaryType(t);
    setPrimarySubType((options[t] || [])[0] ?? '');
    setPrimarySlots(['', '', '']);
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
    if (!itemName.trim()) { setError('아이템 이름을 입력해주세요.'); return; }
    if (!primaryType)     { setError('그래프 기준 옵션을 선택해주세요.'); return; }

    const slotBased = isSlotTyped(primaryType);
    if (slotBased && !primarySlots[0].trim()) {
      setError(`${primaryType}의 슬롯 1에 기준 스탯을 입력해주세요.`);
      return;
    }

    setLoading(true);
    setError(null);
    setChartData(null);
    setColorData(null);

    // 슬롯 타입: 슬롯 1 → option_id, 슬롯 2·3 → 내부 AND 조건
    const optionId = slotBased
      ? buildId(primaryType, primarySlots[0].trim())
      : buildId(primaryType, primarySubType);

    const slotAnds: AndCondition[] = slotBased
      ? ([1, 2] as const)
          .filter(i => primarySlots[i].trim())
          .map(i => ({ type: primaryType, subType: primarySlots[i].trim(), value: '' }))
      : [];

    const allAnds = [...slotAnds, ...andConditions.filter(c => c.type)];

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

    axios.get(`${API_BASE_URL}/graph-data`, {
      params: {
        item_name: itemName.trim(),
        option_id: optionId,
        ...(andStr && { and_options: andStr }),
      },
    })
      .then(res => {
        if (res.data.error) { setError(res.data.error); return; }

        const label = `${res.data.item_name} / ${condLabel}`;
        setResultLabel(label);

        if (res.data.type === 'color') {
          setColorData(res.data.colors);
        } else {
          setChartData({
            labels: res.data.labels,
            datasets: [{
              label: `${label} 최저가`,
              data: res.data.data,
              borderColor: 'rgb(97, 218, 251)',
              backgroundColor: 'rgba(97, 218, 251, 0.12)',
              pointBackgroundColor: 'rgb(97, 218, 251)',
              pointRadius: 4,
              tension: 0.3,
            }],
          });
        }
      })
      .catch(() => setError('데이터를 가져오는 중 오류가 발생했습니다. 아이템 이름이 정확한지 확인해주세요.'))
      .finally(() => setLoading(false));
  };

  // ── 색상 정렬 ─────────────────────────────────────────────────────────────
  const sortedColors = colorData
    ? [...colorData].sort((a, b) => sortDir === 'asc' ? a.price - b.price : b.price - a.price)
    : [];

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

  // ── 차트 옵션 ─────────────────────────────────────────────────────────────
  const lineOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' as const, labels: { color: chartColors.text } },
      title:  { display: true, text: `${resultLabel} 최저가`, color: chartColors.text },
    },
    scales: {
      x: { ticks: { color: chartColors.ticks }, grid: { color: chartColors.grid } },
      y: {
        ticks: { color: chartColors.ticks, callback: (v: any) => fmt(Number(v)) },
        grid:  { color: chartColors.grid },
      },
    },
  };

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title:  { display: true, text: `${resultLabel} — 색상별 최저가`, color: chartColors.text },
      tooltip: { callbacks: { label: (ctx: any) => fmt(ctx.parsed.y) } },
    },
    scales: {
      x: { ticks: { color: chartColors.ticks }, grid: { color: chartColors.grid } },
      y: {
        ticks: { color: chartColors.ticks, callback: (v: any) => fmt(Number(v)) },
        grid:  { color: chartColors.grid },
      },
    },
  };

  // ── 서브컴포넌트 ──────────────────────────────────────────────────────────
  const SubTypeSelect = ({ type, subType, onChange, disabled }: {
    type: string; subType: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => {
    const subs = options[type] || [];
    if (subs.length === 0) return null;
    return (
      <select value={subType} onChange={e => onChange(e.target.value)} disabled={disabled || optionsLoading}>
        {subs.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  };

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
          <input
            type="text"
            value={itemName}
            onChange={e => setItemName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFetch()}
            placeholder="아이템 이름 입력 (예: 나이트브링어 인퀴지터)"
          />
          <button className="btn-primary" onClick={handleFetch} disabled={loading || optionsLoading}>
            {loading ? '불러오는 중…' : '그래프 생성'}
          </button>
        </div>

        {/* 옵션 선택 */}
        <div className="option-section">

          {/* 기준 옵션 — 타입 선택 */}
          <div className="option-row primary-row">
            <span className="option-label">그래프 기준</span>
            <div className="option-selects">
              <select value={primaryType} onChange={e => handlePrimaryTypeChange(e.target.value)} disabled={optionsLoading}>
                {optionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {/* 일반 타입: 서브타입 드롭다운 */}
              {!isSlotTyped(primaryType) && (
                <SubTypeSelect type={primaryType} subType={primarySubType} onChange={setPrimarySubType} />
              )}
            </div>
          </div>

          {/* 슬롯 타입: 3개 콤보박스 */}
          {isSlotTyped(primaryType) && (
            <div className="slot-section">
              {([0, 1, 2] as const).map(i => (
                <div key={i} className="slot-row">
                  <span className={`option-label slot-label${i === 0 ? ' slot-label-primary' : ''}`}>
                    슬롯 {i + 1}{i === 0 ? ' ★' : ''}
                  </span>
                  <ComboboxInput
                    value={primarySlots[i]}
                    onChange={v => updatePrimarySlot(i, v)}
                    suggestions={options[primaryType] || []}
                    placeholder={i === 0 ? '기준 스탯 (필수)' : '추가 조건 (선택)'}
                    disabled={optionsLoading}
                  />
                  {i === 0 && <span className="slot-hint">→ 그래프 X축</span>}
                  {i > 0  && <span className="slot-hint">→ AND 조건</span>}
                </div>
              ))}
            </div>
          )}

          {/* AND 조건 */}
          {andConditions.map((cond, i) => (
            <div key={i} className="option-row and-row">
              <span className="option-label and-label">AND</span>
              <div className="option-selects">
                <select value={cond.type} onChange={e => updateAndCond(i, 'type', e.target.value)} disabled={optionsLoading}>
                  {optionTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                {/* 슬롯 타입 AND: 콤보박스 */}
                {isSlotTyped(cond.type) ? (
                  <ComboboxInput
                    value={cond.subType}
                    onChange={v => updateAndCond(i, 'subType', v)}
                    suggestions={options[cond.type] || []}
                    placeholder="스탯 입력"
                    disabled={optionsLoading}
                  />
                ) : (
                  <SubTypeSelect type={cond.type} subType={cond.subType} onChange={v => updateAndCond(i, 'subType', v)} />
                )}

                {/* 색상 타입 AND: 컬러피커 */}
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

        {/* 색상 결과 */}
        {colorData && colorData.length > 0 && (
          <div className="chart-container">
            <div className="color-controls">
              <span className="color-result-title">{resultLabel}</span>
              <div className="color-control-btns">
                <div className="btn-group">
                  <button className={colorView === 'swatch' ? 'active' : ''} onClick={() => setColorView('swatch')}>스와치</button>
                  <button className={colorView === 'bar'    ? 'active' : ''} onClick={() => setColorView('bar')}>그래프</button>
                </div>
                <div className="btn-group">
                  <button className={sortDir === 'asc'  ? 'active' : ''} onClick={() => setSortDir('asc')}>낮은순</button>
                  <button className={sortDir === 'desc' ? 'active' : ''} onClick={() => setSortDir('desc')}>높은순</button>
                </div>
              </div>
            </div>

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

            {colorView === 'bar' && colorBarData && (
              <Bar options={barOptions} data={colorBarData} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
