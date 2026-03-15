import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

// 색상 옵션 타입 목록 (백엔드 COLOR_TYPES와 동기화)
const COLOR_OPTION_TYPES = new Set(['아이템 색상', '색상']);
const isColorType = (type: string) => COLOR_OPTION_TYPES.has(type);

// ── 유틸리티 ─────────────────────────────────────────────────────────────────

const hexToRgbString = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};

const rgbStringToHex = (rgb: string): string => {
  const nums = rgb.match(/\d+/g);
  if (!nums || nums.length < 3) return '#000000';
  const [r, g, b] = nums.map(Number);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const formatPrice = (price: number) => price.toLocaleString('ko-KR') + '원';

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

type OptionsMap = { [type: string]: string[] };

interface AndCondition {
  type: string;
  subType: string;
  value: string; // 색상 조건일 때 RGB 값 "R,G,B"
}

interface ColorEntry {
  r: number;
  g: number;
  b: number;
  hex: string;
  price: number;
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

function App() {
  const [options, setOptions] = useState<OptionsMap>({});
  const [optionsLoading, setOptionsLoading] = useState(true);

  const [itemName, setItemName] = useState('');
  const [primaryType, setPrimaryType] = useState('');
  const [primarySubType, setPrimarySubType] = useState('');
  const [andConditions, setAndConditions] = useState<AndCondition[]>([]);

  const [chartData, setChartData] = useState<any>(null);
  const [colorData, setColorData] = useState<ColorEntry[] | null>(null);
  const [resultLabel, setResultLabel] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionTypes = Object.keys(options).sort();

  // ── 옵션 목록 로드 ─────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API_BASE_URL}/options`)
      .then(response => {
        const data: OptionsMap = response.data;
        setOptions(data);
        const types = Object.keys(data).sort();
        if (types.length > 0) {
          const first = types[0];
          setPrimaryType(first);
          setPrimarySubType((data[first] || [])[0] ?? '');
        }
      })
      .catch(() => {
        setError('백엔드 서버에서 옵션 목록을 가져올 수 없습니다. 서버가 실행 중인지 확인하세요.');
      })
      .finally(() => setOptionsLoading(false));
  }, []);

  // ── 핸들러 ────────────────────────────────────────────────────────────────
  const handlePrimaryTypeChange = (type: string) => {
    setPrimaryType(type);
    setPrimarySubType((options[type] || [])[0] ?? '');
  };

  const addAndCondition = () => {
    if (andConditions.length >= 2) return;
    const firstType = optionTypes[0] ?? '';
    setAndConditions([...andConditions, {
      type: firstType,
      subType: (options[firstType] || [])[0] ?? '',
      value: isColorType(firstType) ? '0,0,0' : '',
    }]);
  };

  const removeAndCondition = (index: number) => {
    setAndConditions(andConditions.filter((_, i) => i !== index));
  };

  const updateAndCondition = (index: number, field: 'type' | 'subType', value: string) => {
    const updated = [...andConditions];
    if (field === 'type') {
      updated[index] = {
        type: value,
        subType: (options[value] || [])[0] ?? '',
        value: isColorType(value) ? '0,0,0' : '',
      };
    } else {
      updated[index] = { ...updated[index], subType: value };
    }
    setAndConditions(updated);
  };

  const updateAndConditionColor = (index: number, rgbString: string) => {
    const updated = [...andConditions];
    updated[index] = { ...updated[index], value: rgbString };
    setAndConditions(updated);
  };

  const buildOptionId = (type: string, subType: string) =>
    subType ? `${type}|${subType}` : type;

  const handleFetchGraphData = () => {
    if (!itemName.trim()) {
      setError('아이템 이름을 입력해주세요.');
      return;
    }
    if (!primaryType) {
      setError('그래프 기준 옵션을 선택해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    setChartData(null);
    setColorData(null);

    const optionId = buildOptionId(primaryType, primarySubType);

    // AND 조건: 세미콜론으로 구분, 색상 조건은 값 포함
    const andOptionsStr = andConditions
      .filter(c => c.type)
      .map(c => {
        const id = buildOptionId(c.type, c.subType);
        return isColorType(c.type) && c.value ? `${id}|${c.value}` : id;
      })
      .join(';');

    const conditionLabel = [
      optionId,
      ...andConditions.filter(c => c.type).map(c => {
        const id = buildOptionId(c.type, c.subType);
        return isColorType(c.type) && c.value ? `${id}=(${c.value})` : id;
      }),
    ].join(' + ');

    axios.get(`${API_BASE_URL}/graph-data`, {
      params: {
        item_name: itemName.trim(),
        option_id: optionId,
        ...(andOptionsStr && { and_options: andOptionsStr }),
      },
    })
      .then(response => {
        if (response.data.error) {
          setError(response.data.error);
          return;
        }

        const label = `${response.data.item_name} / ${conditionLabel}`;
        setResultLabel(label);

        if (response.data.type === 'color') {
          setColorData(response.data.colors);
        } else {
          setChartData({
            labels: response.data.labels,
            datasets: [{
              label: `${label} 최저가`,
              data: response.data.data,
              borderColor: 'rgb(75, 192, 192)',
              backgroundColor: 'rgba(75, 192, 192, 0.5)',
            }],
          });
        }
      })
      .catch(() => {
        setError('데이터를 가져오는 중 오류가 발생했습니다. 아이템 이름이 정확한지 확인해주세요.');
      })
      .finally(() => setLoading(false));
  };

  // ── 서브컴포넌트: 서브타입 셀렉트 ──────────────────────────────────────────
  const SubTypeSelect = ({
    type, subType, onSubTypeChange, disabled,
  }: {
    type: string; subType: string;
    onSubTypeChange: (v: string) => void;
    disabled?: boolean;
  }) => {
    const subTypes = options[type] || [];
    if (subTypes.length === 0) return null;
    return (
      <select
        value={subType}
        onChange={e => onSubTypeChange(e.target.value)}
        disabled={disabled || optionsLoading}
      >
        {subTypes.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="App">
      <header className="App-header">
        <h1>마비노기 아이템 옵션별 가격 그래프</h1>
        <p>아이템의 특정 옵션 수치에 따른 경매장 최저가 변화를 확인합니다.</p>
      </header>

      <main className="App-main">

        {/* 아이템 이름 */}
        <div className="controls">
          <input
            type="text"
            value={itemName}
            onChange={e => setItemName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFetchGraphData()}
            placeholder="아이템 이름 입력 (예: 나이트브링어 인퀴지터)"
          />
        </div>

        {/* 옵션 선택 */}
        <div className="option-section">

          {/* 기준 옵션 */}
          <div className="option-row primary-row">
            <span className="option-label">그래프 기준</span>
            <div className="option-selects">
              <select
                value={primaryType}
                onChange={e => handlePrimaryTypeChange(e.target.value)}
                disabled={optionsLoading}
              >
                {optionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <SubTypeSelect
                type={primaryType}
                subType={primarySubType}
                onSubTypeChange={setPrimarySubType}
              />
            </div>
          </div>

          {/* AND 조건들 */}
          {andConditions.map((cond, i) => (
            <div key={i} className="option-row and-row">
              <span className="option-label and-label">AND</span>
              <div className="option-selects">
                <select
                  value={cond.type}
                  onChange={e => updateAndCondition(i, 'type', e.target.value)}
                  disabled={optionsLoading}
                >
                  {optionTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <SubTypeSelect
                  type={cond.type}
                  subType={cond.subType}
                  onSubTypeChange={v => updateAndCondition(i, 'subType', v)}
                />
                {/* 색상 조건: 색상 피커 */}
                {isColorType(cond.type) && (
                  <div className="color-picker-inline">
                    <input
                      type="color"
                      value={rgbStringToHex(cond.value || '0,0,0')}
                      onChange={e => updateAndConditionColor(i, hexToRgbString(e.target.value))}
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

        {/* 실행 버튼 */}
        <div className="controls">
          <button onClick={handleFetchGraphData} disabled={loading || optionsLoading}>
            {loading ? '불러오는 중...' : '그래프 생성'}
          </button>
        </div>

        {/* 에러 */}
        {error && (
          <div className="result-container">
            <p className="error-message">{error}</p>
          </div>
        )}

        {/* 수치 그래프 */}
        {chartData && (
          <div className="chart-container">
            <Line
              options={{
                responsive: true,
                plugins: {
                  legend: { position: 'top' as const },
                  title: { display: true, text: `${resultLabel} 최저가` },
                },
              }}
              data={chartData}
            />
          </div>
        )}

        {/* 색상 그래프 */}
        {colorData && colorData.length > 0 && (
          <div className="chart-container">
            <h3 className="color-chart-title">{resultLabel} — 색상별 최저가</h3>
            <div className="color-grid">
              {colorData.map((entry, i) => (
                <div key={i} className="color-swatch-card">
                  <div
                    className="color-swatch-box"
                    style={{ backgroundColor: entry.hex }}
                  />
                  <div className="color-swatch-info">
                    <span className="color-hex">{entry.hex.toUpperCase()}</span>
                    <span className="color-rgb">({entry.r}, {entry.g}, {entry.b})</span>
                    <span className="color-price">{formatPrice(entry.price)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
