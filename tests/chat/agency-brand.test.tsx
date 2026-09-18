import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgencyBrand } from '@/features/chat/components/agency-brand';

describe('AgencyBrand', () => {
  it('renders the official marks, agency name, and internal demo label', () => {
    render(<AgencyBrand variant="header" />);

    expect(screen.getByRole('img', { name: /quốc huy việt nam/i })).toBeVisible();
    expect(screen.getByRole('img', { name: /logo bảo hiểm xã hội việt nam/i })).toBeVisible();
    expect(screen.getByText('BẢO HIỂM XÃ HỘI TỈNH KHÁNH HÒA')).toBeVisible();
    expect(screen.getByText('Sản phẩm MVP/DEMO nội bộ')).toBeVisible();
  });

  it('keeps both marks dimensioned in the compact variant', () => {
    render(<AgencyBrand variant="compact" />);

    for (const image of screen.getAllByRole('img')) {
      expect(image).toHaveAttribute('width');
      expect(image).toHaveAttribute('height');
    }
    expect(screen.getByText('BHXH TỈNH KHÁNH HÒA')).toBeVisible();
  });
});
