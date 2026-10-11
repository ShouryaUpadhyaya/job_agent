import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import Health from './Health';

test('renders health check component', () => {
  render(<Health />);
  expect(screen.getByText('Health Check')).toBeDefined();
});
