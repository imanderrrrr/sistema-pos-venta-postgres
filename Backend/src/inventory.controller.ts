/**
 * Extracted from a real-world production backend.
 * Originally part of a monolithic Express + PostgreSQL application.
 * Refactored and shared for portfolio demonstration purposes.
 */

import { Request, Response } from 'express';
import { query } from './db';
import { InventoryService, Product } from './inventory.service';

/**
 * Controller class for inventory/product management
 * Handles HTTP requests, delegates business logic to InventoryService
 */
export class InventoryController {
  private inventoryService: InventoryService;

  constructor() {
    this.inventoryService = new InventoryService();
  }
  /**
   * GET all products with their size variants
   * Fetches products and maps them using service layer
   */
  async getAllProducts(req: Request, res: Response): Promise<void> {
    try {
      const productsResult = await query(`
        SELECT * FROM products ORDER BY created_at DESC
      `);

      const products = await Promise.all(
        productsResult.rows.map(async (product: any) => {
          let sizes = null;
          if (product.has_sizes) {
            const sizesResult = await query(
              'SELECT size, quantity FROM product_sizes WHERE product_id = $1 ORDER BY size',
              [product.id]
            );
            sizes = sizesResult.rows;
          }

          return this.inventoryService.mapProductFromDB(product, sizes);
        })
      );

      res.json(products);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al obtener productos' });
    }
  }

  /**
   * GET single product by ID
   * Includes size variants if applicable
   */
  async getProductById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    try {
      const product = await this.inventoryService.getProductWithSizes(id);

      if (!product) {
        res.status(404).json({ message: 'Producto no encontrado' });
        return;
      }

      res.json(product);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al obtener producto' });
    }
  }

  /**
   * GET product by barcode
   * Used for barcode scanner integration at POS
   */
  async getProductByBarcode(req: Request, res: Response): Promise<void> {
    const { barcode } = req.params;

    try {
      const productResult = await query('SELECT * FROM products WHERE barcode = $1', [
        barcode
      ]);

      if (productResult.rows.length === 0) {
        res.status(404).json({ message: 'Producto no encontrado' });
        return;
      }

      const productId = productResult.rows[0].id;
      const product = await this.inventoryService.getProductWithSizes(productId);

      res.json(product);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al buscar producto por código de barras' });
    }
  }

  /**
   * POST create new product
   * Validates input, delegates creation to service layer
   */
  async createProduct(req: Request, res: Response): Promise<void> {
    const {
      name,
      sku,
      cost,
      price,
      stock,
      category,
      productType,
      barcode,
      minStock,
      hasSizes,
      sizeType,
      sizes
    } = req.body;

    // Validate input data
    const validation = this.inventoryService.validateProductData(req.body);
    if (!validation.isValid) {
      res.status(400).json({ message: validation.error });
      return;
    }

    try {
      const parsedCost = this.inventoryService.parseCost(cost);
      const parsedPrice = parseFloat(price);

      const productId = await this.inventoryService.createProduct({
        name,
        sku,
        cost: parsedCost,
        price: parsedPrice,
        stock: stock || 0,
        category,
        productType,
        barcode,
        minStock,
        hasSizes: !!hasSizes,
        sizeType,
        sizes
      });

      res.status(201).json({ message: 'Producto creado exitosamente', id: productId });
    } catch (err: any) {
      this.handleDatabaseError(err, res, 'Error al crear producto');
    }
  }

  /**
   * PUT update existing product
   * Validates input, delegates update to service layer
   */
  async updateProduct(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const {
      name,
      sku,
      cost,
      price,
      stock,
      category,
      productType,
      barcode,
      minStock,
      hasSizes,
      sizeType,
      sizes
    } = req.body;

    try {
      const parsedCost = this.inventoryService.parseCost(cost);

      await this.inventoryService.updateProduct(id, {
        name,
        sku,
        cost: parsedCost,
        price: parseFloat(price),
        stock: stock || 0,
        category,
        productType,
        barcode,
        minStock,
        hasSizes: hasSizes || false,
        sizeType,
        sizes
      });

      res.json({ message: 'Producto actualizado exitosamente' });
    } catch (err: any) {
      this.handleDatabaseError(err, res, 'Error al actualizar producto');
    }
  }

  /**
   * DELETE product
   * Cascades to delete related size variants
   */
  async deleteProduct(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    try {
      await query('DELETE FROM products WHERE id = $1', [id]);
      res.json({ message: 'Producto eliminado exitosamente' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al eliminar producto' });
    }
  }

  /**
   * PATCH update stock for products without sizes
   * Quantity can be negative to reduce stock
   * Delegates to service layer for consistency
   */
  async updateStock(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { quantity } = req.body;

    try {
      await this.inventoryService.updateStockSimple(id, quantity);
      res.json({ message: 'Stock actualizado exitosamente' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al actualizar stock' });
    }
  }

  /**
   * PATCH update stock by size
   * Updates specific size variant and recalculates total product stock
   * Delegates to service layer for business logic consistency
   */
  async updateStockBySize(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { size, quantity } = req.body;

    try {
      await this.inventoryService.updateStockBySize(id, size, quantity);
      res.json({ message: 'Stock actualizado exitosamente' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al actualizar stock por talla' });
    }
  }

  /**
   * Centralized database error handler
   * Maps PostgreSQL error codes to user-friendly messages
   */
  private handleDatabaseError(err: any, res: Response, defaultMessage: string): void {
    console.error(err);

    if (err.code === '23505') {
      res.status(400).json({ message: 'El SKU o código de barras ya existe' });
      return;
    }
    if (err.code === '23502') {
      res.status(400).json({ message: 'Violación de NOT NULL en la base de datos' });
      return;
    }
    if (err.code === '23514') {
      res
        .status(400)
        .json({ message: 'Violación de restricción CHECK (product_type o size_type)' });
      return;
    }

    res.status(500).json({ message: defaultMessage });
  }
}
