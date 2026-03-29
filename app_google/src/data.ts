export interface Paper {
  id: string;
  x: number;
  y: number;
  title: string;
  abstract: string;
  year: number;
  field: string;
  author: string;
  publishDate: string;
}

const FIELDS = [
  { name: 'Machine Learning', cx: 20, cy: 20, color: '#4285F4' }, // Google Blue
  { name: 'Biology', cx: -20, cy: 15, color: '#34A853' }, // Google Green
  { name: 'Physics', cx: 10, cy: -25, color: '#FBBC05' }, // Google Yellow
  { name: 'Psychology', cx: -15, cy: -20, color: '#EA4335' }, // Google Red
  { name: 'Sociology', cx: 0, cy: 0, color: '#8AB4F8' }, // Light Blue
  { name: 'Medicine', cx: -5, cy: 30, color: '#F28B82' }, // Light Red
];

const AUTHORS = [
  'Dr. Aris Thorne', 'Sarah Jenkins', 'Prof. Michael Chen', 'Elena Rodriguez',
  'James Wilson', 'Dr. Linda Park', 'Robert Smith', 'Maria Garcia'
];

// Box-Muller transform for normal distribution
function randomNormal(mean: number, stdDev: number) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * stdDev + mean;
}

function generateMockData(count: number): Paper[] {
  const papers: Paper[] = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const field = FIELDS[Math.floor(Math.random() * FIELDS.length)];
    const year = Math.floor(Math.random() * (2024 - 2010 + 1)) + 2010;
    
    // Generate a random date within the last 30 days for some papers to be "latest"
    const isRecent = Math.random() > 0.95;
    const date = new Date();
    if (isRecent) {
      date.setDate(now.getDate() - Math.floor(Math.random() * 7));
    } else {
      date.setFullYear(year);
      date.setMonth(Math.floor(Math.random() * 12));
      date.setDate(Math.floor(Math.random() * 28));
    }

    papers.push({
      id: `paper-${i}`,
      x: randomNormal(field.cx, 8),
      y: randomNormal(field.cy, 8),
      title: `A Study on ${field.name} Concepts ${i}`,
      abstract: `This paper explores various aspects of ${field.name}. We present a novel approach to understanding the underlying mechanisms and their applications in modern contexts. The results demonstrate significant improvements over baseline methods, particularly in the context of ${year}'s technological landscape.`,
      year: date.getFullYear(),
      field: field.name,
      author: AUTHORS[Math.floor(Math.random() * AUTHORS.length)],
      publishDate: date.toISOString(),
    });
  }
  return papers;
}

export const papersData = generateMockData(5000);
export const fieldColors = Object.fromEntries(FIELDS.map(f => [f.name, f.color]));
export const fieldList = FIELDS.map(f => f.name);
