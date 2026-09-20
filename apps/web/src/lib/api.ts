const TOKEN_KEY = 'ef.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { campo: string; mensagem: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    clearToken();
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'Sessão expirada.');
  }

  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data ? (data as any).error : null) ?? 'Falha na requisição';
    throw new ApiError(res.status, String(msg), (data as any)?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
  download: async (p: string, filename: string) => {
    const res = await fetch(`/api${p}`, {
      headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// ─────────────────────────── tipos ───────────────────────────
export interface Me {
  user: { id: string; name: string; email: string; role: string; tutorialDone: boolean; tutorialStep: number; mustChangePassword?: boolean };
  company: { id: string; name: string; slug: string; sheetSyncOn?: boolean; sheetLastSync?: string | null };
}
export interface Warehouse {
  id: string; code: string; name: string; city?: string | null; state?: string | null;
  isDefault: boolean; active: boolean;
}
export interface Product {
  id: string; sku: string; barcode: string | null; name: string; unit: string;
  size?: string | null; measure?: number | null; measureUnit?: string | null;
  costPrice: number; salePrice: number; minStock: number; active: boolean;
  category?: { id: string; name: string } | null;
  totalStock?: number;
  stockByWarehouse?: { warehouseId: string; warehouse: string; code: string; quantity: number }[];
}
export interface StockRow {
  productId: string; sku: string; barcode: string | null; name: string; unit: string;
  category: string | null; warehouseId: string; warehouse: string; warehouseCode: string;
  quantity: number; reserved: number; available: number; minStock: number;
  avgCost: number; salePrice: number; stockValue: number; belowMin: boolean;
}
export interface MovementRow {
  id: string; number: number; type: string; status: string;
  product: { id: string; sku: string; name: string; unit: string };
  quantity: number; unitCost: number;
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  reason: string | null; document: string | null; notes: string | null; user: string; createdAt: string;
}
export interface Dashboard {
  valorTotalEstoque: number; unidadesTotais: number; produtosAtivos: number;
  depositos: { id: string; code: string; name: string; skus: number; unidades: number; valor: number; abaixoMinimo: number }[];
  alertas: { abaixoMinimo: number; lista: { productId: string; sku: string; name: string; warehouse: string; quantity: number; minStock: number; falta: number }[] };
  vendas: { hoje: { qtd: number; total: number }; ultimos30: { qtd: number; receita: number; custo: number; margem: number } };
  movimentos7dias: { tipo: string; qtd: number }[];
  ultimasMovimentacoes: { id: string; number: number; tipo: string; produto: string; sku: string; quantidade: number; origem: string | null; destino: string | null; usuario: string; data: string }[];
}
export interface TutorialStep {
  id: number; key: string; title: string; body: string; route: string; anchor: string | null; action: string;
}
