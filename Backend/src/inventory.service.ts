/**
 * Extracted from a real-world production backend.
 * Originally part of a monolithic Express + PostgreSQL application.
 * Refactored and shared for portfolio demonstration purposes.
 */
//inventory.service.ts

import { query } from './db';
import crypto from 'crypto';

/**
 * Product with optional size variants
 */
export interface Product {
  id: string;
  name: string;
  sku: string;
  cost?: number;
  price: number;
  stock: number;
  category: string;
  productType: 'ropa' | 'otros';
  barcode?: string;
  minStock?: number;
  hasSizes: boolean;
  sizeType?: 'letter' | 'number';
  sizes?: ProductSize[];
}

/**
 * Size variant for a product
 */
export interface ProductSize {
  size: string;
  quantity: number;
}

/**
 * Result of product validation
 */
interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Service layer for inventory business logic
 * Handles validation, stock calculations, and data transformation
 */
export class InventoryService {
  /**
   * Validate product creation/update data
   * Business rules:
   * - Required fields must be present
   * - Price must be positive
   * - Cost must be non-negative if provided
   * - Product type must be 'ropa' or 'otros'
   */
  validateProductData(data: any): ValidationResult {
    const { name, sku, price, category, productType, cost } = data;

    if (!name || !sku || price === undefined || price === null || !category || !productType) {
      return {
        isValid: false,
        error: 'Campos obligatorios faltantes (name, sku, price, category, productType)'
      };
    }

    if (!['ropa', 'otros'].includes(productType)) {
      return { isValid: false, error: 'productType inválido' };
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return { isValid: false, error: 'Precio inválido' };
    }

    if (cost !== undefined && cost !== null && cost !== '') {
      const parsedCost = parseFloat(cost);
      if (isNaN(parsedCost) || parsedCost < 0) {
        return { isValid: false, error: 'Costo inválido' };
      }
    }

    return { isValid: true };
  }

  /**
   * Calculate total stock from size variants
   * If product has sizes, sum all size quantities
   * Otherwise, return the stock value provided
   */
  calculateTotalStock(hasSizes: boolean, sizes: any[] | undefined, baseStock: number): number {
    if (!hasSizes || !sizes || !Array.isArray(sizes) || sizes.length === 0) {
      return baseStock || 0;
    }

    return sizes.reduce((sum: number, size: any) => {
      const quantity = parseInt(size.quantity) || 0;
      return sum + quantity;
    }, 0);
  }

  /**
   * Parse cost value, handling null/undefined/empty string
   * Returns null if cost is not provided or invalid
   */
  parseCost(cost: any): number | null {
    if (cost === undefined || cost === null || cost === '') {
      return null;
    }

    const parsed = parseFloat(cost);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Map database row to Product interface
   * Handles type conversions and null values
   */
  mapProductFromDB(product: any, sizes: any[] | null): Product {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      cost: product.cost ? parseFloat(product.cost) : undefined,
      price: parseFloat(product.price),
      stock: product.stock,
      category: product.category,
      productType: product.product_type,
      barcode: product.barcode || undefined,
      minStock:
        product.min_stock !== null && product.min_stock !== undefined
          ? parseFloat(product.min_stock)
          : undefined,
      hasSizes: product.has_sizes,
      sizeType: product.size_type || undefined,
      sizes: sizes || undefined
    };
  }

  /**
   * Fetch product with its size variants
   */
  async getProductWithSizes(productId: string): Promise<Product | null> {
    const productResult = await query('SELECT * FROM products WHERE id = $1', [productId]);

    if (productResult.rows.length === 0) {
      return null;
    }

    const product = productResult.rows[0];
    let sizes = null;

    if (product.has_sizes) {
      const sizesResult = await query(
        'SELECT size, quantity FROM product_sizes WHERE product_id = $1 ORDER BY size',
        [product.id]
      );
      sizes = sizesResult.rows;
    }

    return this.mapProductFromDB(product, sizes);
  }

  /**
   * Create product in database with size variants
   * Returns the created product ID
   */
  async createProduct(productData: {
    name: string;
    sku: string;
    cost: number | null;
    price: number;
    stock: number;
    category: string;
    productType: string;
    barcode?: string;
    minStock?: number;
    hasSizes: boolean;
    sizeType?: string;
    sizes?: ProductSize[];
  }): Promise<string> {
    const productId = crypto.randomUUID();
    const totalStock = this.calculateTotalStock(
      productData.hasSizes,
      productData.sizes,
      productData.stock
    );

    await query(
      `INSERT INTO products (id, name, sku, cost, price, stock, category, product_type, barcode, min_stock, has_sizes, size_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        productId,
        productData.name,
        productData.sku,
        productData.cost,
        productData.price,
        totalStock,
        productData.category,
        productData.productType,
        productData.barcode || null,
        productData.minStock ?? 0,
        productData.hasSizes,
        productData.hasSizes ? productData.sizeType || null : null
      ]
    );

    // Insert size variants if applicable
    if (productData.hasSizes && productData.sizes && productData.sizes.length > 0) {
      await this.insertSizeVariants(productId, productData.sizes);
    }

    return productId;
  }

  /**
   * Update product and its size variants
   */
  async updateProduct(
    productId: string,
    productData: {
      name: string;
      sku: string;
      cost: number | null;
      price: number;
      stock: number;
      category: string;
      productType: string;
      barcode?: string;
      minStock?: number;
      hasSizes: boolean;
      sizeType?: string;
      sizes?: ProductSize[];
    }
  ): Promise<void> {
    const totalStock = this.calculateTotalStock(
      productData.hasSizes,
      productData.sizes,
      productData.stock
    );

    await query(
      `UPDATE products 
       SET name = $1, sku = $2, cost = $3, price = $4, stock = $5, category = $6, 
           product_type = $7, barcode = $8, min_stock = $9, has_sizes = $10, size_type = $11
       WHERE id = $12`,
      [
        productData.name,
        productData.sku,
        productData.cost,
        productData.price,
        totalStock,
        productData.category,
        productData.productType,
        productData.barcode || null,
        productData.minStock ?? 0,
        productData.hasSizes,
        productData.sizeType || null,
        productId
      ]
    );

    // Replace size variants
    await query('DELETE FROM product_sizes WHERE product_id = $1', [productId]);

    if (productData.hasSizes && productData.sizes && productData.sizes.length > 0) {
      await this.insertSizeVariants(productId, productData.sizes);
    }
  }

  /**
   * Insert size variants for a product
   */
  private async insertSizeVariants(productId: string, sizes: ProductSize[]): Promise<void> {
    for (const size of sizes) {
      await query(
        'INSERT INTO product_sizes (product_id, size, quantity) VALUES ($1, $2, $3)',
        [productId, size.size, parseInt(String(size.quantity)) || 0]
      );
    }
  }

  /**
   * Update stock for a product without size variants
   */
  async updateStockSimple(productId: string, quantity: number): Promise<void> {
    await query(
      'UPDATE products SET stock = stock + $1 WHERE id = $2 AND has_sizes = false',
      [quantity, productId]
    );
  }

  /**
   * Update stock for a specific size variant
   * Recalculates total product stock after update
   */
  async updateStockBySize(productId: string, size: string, quantity: number): Promise<void> {
    // Update specific size quantity
    await query(
      'UPDATE product_sizes SET quantity = quantity + $1 WHERE product_id = $2 AND size = $3',
      [quantity, productId, size]
    );

    // Recalculate and update total stock
    const sizesResult = await query(
      'SELECT SUM(quantity) as total FROM product_sizes WHERE product_id = $1',
      [productId]
    );
    const totalStock = sizesResult.rows[0].total || 0;

    await query('UPDATE products SET stock = $1 WHERE id = $2', [totalStock, productId]);
  }
}
