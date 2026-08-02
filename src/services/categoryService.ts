import { apiDelete, apiGet, apiPost, apiPut } from '../config/api';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../config/constants';
import { onSSE } from '../lib/sse';
import type { Category, CategoryFormData } from '../types';
import { mapCategory } from './supabaseMappers';

const localKey = (userId: string) => `cashflow-local-categories-${userId}`;

function defaultCategories(userId: string): Category[] {
  const now = new Date();
  return [
    ...EXPENSE_CATEGORIES.map((category) => ({
      id: category.id,
      userId,
      name: category.name,
      type: 'expense' as const,
      icon: category.icon,
      color: category.color,
      isDefault: true,
      createdAt: now,
    })),
    ...INCOME_CATEGORIES.map((category) => ({
      id: category.id,
      userId,
      name: category.name,
      type: 'income' as const,
      icon: category.icon,
      color: category.color,
      isDefault: true,
      createdAt: now,
    })),
  ];
}

function readLocalCategories(userId: string): Category[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) {
      const defaults = defaultCategories(userId);
      writeLocalCategories(userId, defaults);
      return defaults;
    }
    return (JSON.parse(raw) as Category[]).map((category) => ({ ...category, createdAt: new Date(category.createdAt) }));
  } catch {
    return defaultCategories(userId);
  }
}

function writeLocalCategories(userId: string, categories: Category[]) {
  localStorage.setItem(localKey(userId), JSON.stringify(categories));
}

async function fetchCategories(userId: string): Promise<Category[]> {
  try {
    const rows = await apiGet<any[]>('/api/categories');
    if (!rows || rows.length === 0) {
      // Auto initialize default categories if empty
      await initializeDefaultCategories(userId);
      const reFetched = await apiGet<any[]>('/api/categories');
      return (reFetched || []).map(mapCategory);
    }
    return (rows || []).map(mapCategory);
  } catch {
    return readLocalCategories(userId);
  }
}

export function listenToCategories(
  userId: string,
  callback: (categories: Category[]) => void,
  errorCallback?: (error: Error) => void
): () => void {
  fetchCategories(userId).then(callback).catch(errorCallback);

  const unsub = onSSE('category:changed', () => {
    fetchCategories(userId).then(callback).catch(errorCallback);
  });

  return unsub;
}

export async function initializeDefaultCategories(userId: string): Promise<void> {
  const defaults = defaultCategories(userId);
  try {
    await apiPost('/api/categories/init-defaults', { categories: defaults });
  } catch {
    readLocalCategories(userId);
  }
}

export async function addCategory(userId: string, data: CategoryFormData): Promise<string> {
  try {
    const res = await apiPost<{ id: string }>('/api/categories', data);
    return res.id;
  } catch {
    const categories = readLocalCategories(userId);
    const id = `local-category-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    writeLocalCategories(userId, [...categories, {
      id,
      userId,
      name: data.name,
      type: data.type,
      icon: data.icon || 'MoreHorizontal',
      color: data.color || '#6b7280',
      isDefault: false,
      createdAt: new Date(),
    }]);
    return id;
  }
}

export async function updateCategory(userId: string, categoryId: string, data: Partial<CategoryFormData>): Promise<void> {
  try {
    await apiPut(`/api/categories/${categoryId}`, data);
  } catch {
    writeLocalCategories(userId, readLocalCategories(userId).map((category) =>
      category.id === categoryId ? { ...category, ...data } : category
    ));
  }
}

export async function deleteCategory(userId: string, categoryId: string): Promise<void> {
  try {
    await apiDelete(`/api/categories/${categoryId}`);
  } catch {
    writeLocalCategories(userId, readLocalCategories(userId).filter((category) => category.id !== categoryId || category.isDefault));
  }
}
