import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

it('renders the legal assistant scope', () => {
  render(<Home />);
  expect(screen.getByRole('heading', { name: /bảo hiểm xã hội tỉnh khánh hòa/i })).toBeVisible();
  expect(screen.getByText(/bốn nghị định trong bộ dữ liệu demo/i)).toBeVisible();
});
