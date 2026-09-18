interface AgencyBrandProps {
  variant: 'header' | 'compact';
}

const BRAND_ASSETS = {
  crest: '/brand/quoc-huy-viet-nam.jpg',
  logo: '/brand/logo-bhxh-viet-nam.svg',
} as const;

export function AgencyBrand({ variant }: AgencyBrandProps) {
  const compact = variant === 'compact';
  const agencyName = compact
    ? 'BHXH TỈNH KHÁNH HÒA'
    : 'BẢO HIỂM XÃ HỘI TỈNH KHÁNH HÒA';

  return (
    <div className={`agency-brand agency-brand--${variant}`} aria-label={agencyName}>
      <Image
        className="agency-brand__crest"
        src={BRAND_ASSETS.crest}
        alt="Quốc huy Việt Nam"
        width={compact ? 32 : 44}
        height={compact ? 32 : 45}
        decoding="async"
      />
      <div className="agency-brand__copy">
        {compact ? (
          <span className="agency-brand__name">{agencyName}</span>
        ) : (
          <h1 className="agency-brand__name">{agencyName}</h1>
        )}
        {!compact && <span className="agency-brand__demo">Sản phẩm MVP/DEMO nội bộ</span>}
      </div>
      <Image
        className="agency-brand__logo"
        src={BRAND_ASSETS.logo}
        alt="Logo Bảo hiểm xã hội Việt Nam"
        width={compact ? 32 : 44}
        height={compact ? 32 : 44}
        decoding="async"
      />
    </div>
  );
}
import Image from 'next/image';
