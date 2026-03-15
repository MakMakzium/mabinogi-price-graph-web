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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

function App() {
  const [options, setOptions] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [itemName, setItemName] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [chartData, setChartData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 백엔드에서 옵션 목록 가져오기
    axios.get(`${API_BASE_URL}/options`)
      .then(response => {
        setOptions(response.data);
        if (response.data.length > 0) {
            setSelectedOption(response.data[0]);
        }
      })
      .catch(error => {
        console.error('옵션 목록을 가져오는 데 실패했습니다.', error);
        setError('백엔드 서버에서 옵션 목록을 가져올 수 없습니다. 서버가 실행 중인지 확인하세요.');
      })
      .finally(() => {
        setOptionsLoading(false);
      });
  }, []);

  const handleFetchGraphData = () => {
    if (!itemName || !selectedOption) {
      setError('아이템 이름과 옵션을 모두 선택해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    setChartData(null);

    axios.get(`${API_BASE_URL}/graph-data`, {
      params: {
        item_name: itemName,
        option_id: selectedOption
      }
    })
    .then(response => {
        if (response.data.error) {
            setError(response.data.error);
            return;
        }
      const data = {
        labels: response.data.labels,
        datasets: [
          {
            label: `${response.data.item_name} - ${response.data.option_name}별 최저가`,
            data: response.data.data,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
          },
        ],
      };
      setChartData(data);
    })
    .catch(error => {
      console.error('그래프 데이터를 가져오는 데 실패했습니다.', error);
      setError('데이터를 가져오는 중 오류가 발생했습니다. 아이템 이름이 정확한지 확인해주세요.');
    })
    .finally(() => {
      setLoading(false);
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>마비노기 아이템 옵션별 가격 그래프</h1>
        <p>아이템의 특정 옵션 수치에 따른 경매장 최저가 변화를 확인합니다.</p>
      </header>
      <main className="App-main">
        <div className="controls">
          <input
            type="text"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFetchGraphData()}
            placeholder="아이템 이름 입력 (예: 나이트브링어 인퀴지터)"
          />
          <select value={selectedOption} onChange={(e) => setSelectedOption(e.target.value)} disabled={optionsLoading}>
            {optionsLoading
              ? <option>불러오는 중...</option>
              : options.map(option => (
                <option key={option} value={option}>
                  {option.replace('|', ' - ')}
                </option>
              ))
            }
          </select>
          <button onClick={handleFetchGraphData} disabled={loading}>
            {loading ? '불러오는 중...' : '그래프 생성'}
          </button>
        </div>
        {(error || chartData) && (
          <div className="chart-container">
            {error && <p className="error-message">{error}</p>}
            {chartData && (
              <Line
                options={{
                  responsive: true,
                  plugins: {
                    legend: {
                      position: 'top' as const,
                    },
                    title: {
                      display: true,
                      text: `${chartData.datasets[0].label}`,
                    },
                  },
                }}
                data={chartData}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
