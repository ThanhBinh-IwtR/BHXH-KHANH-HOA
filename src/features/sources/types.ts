export interface SourceDetail {
  sourceId: string;
  documentNumber: string;
  breadcrumb: string;
  articleTitle: string | null;
  bodyText: string;
  pageFrom: number;
  pageTo: number;
  pdfUrl: string;
}
