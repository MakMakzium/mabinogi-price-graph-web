import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders app header', () => {
  render(<App />);
  const heading = screen.getByText(/마비노기 아이템 옵션별 가격 그래프/i);
  expect(heading).toBeInTheDocument();
});

test('renders item name input', () => {
  render(<App />);
  const input = screen.getByPlaceholderText(/아이템 이름 입력/i);
  expect(input).toBeInTheDocument();
});

test('renders graph button', () => {
  render(<App />);
  const button = screen.getByRole('button', { name: /그래프 생성/i });
  expect(button).toBeInTheDocument();
});
