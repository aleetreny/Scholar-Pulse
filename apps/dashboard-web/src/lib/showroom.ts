export type Theme = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  accent: string;
};

export type Paper = {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  publishedAt: string;
  updatedAt: string;
  arxivUrl: string;
  pdfUrl: string;
  primaryCategory: string;
  categories: string[];
  themeId: string;
};

export type PulseData = {
  generatedAt: string;
  source: {
    name: string;
    url: string;
    note: string;
  };
  themes: Theme[];
  papers: Paper[];
  warnings: string[];
};
