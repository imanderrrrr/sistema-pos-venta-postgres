/**
 * Extracted from a real-world production backend.
 * Originally part of a monolithic Express + PostgreSQL application.
 * Refactored and shared for portfolio demonstration purposes.
 */
//cash-register.service.ts
import { query } from './db';
import crypto from 'crypto';

/**
 * Cash register status
 */
export interface CashRegister {
  id: string;
  userId: string;
  openingBalance: number;
  closingBalance?: number;
  expectedBalance?: number;
  difference?: number;
  status: 'abierta' | 'cerrada';
  openedAt: Date;
  closedAt?: Date;
  openedByName?: string;
  closedByName?: string;
}

/**
 * Cash movement record
 */
export interface CashMovement {
  id: string;
  registerId: string;
  userId: string;
  type: 'entrada' | 'salida';
  amount: number;
  concept: string;
  date: Date;
}

/**
 * Service class for cash register operations
 * Handles opening, closing, movements, and history of cash registers
 */
export class CashRegisterService {
  /**
   * Get current open cash register for a user
   * @param userId - ID of the user
   * @returns Cash register or null if none open
   */
  async getCurrentRegister(userId: string): Promise<CashRegister | null> {
    const result = await query(
      'SELECT * FROM cash_registers WHERE user_id = $1 AND status = \'abierta\' ORDER BY opened_at DESC LIMIT 1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      openingBalance: parseFloat(row.opening_balance),
      closingBalance: row.closing_balance ? parseFloat(row.closing_balance) : undefined,
      expectedBalance: row.expected_balance ? parseFloat(row.expected_balance) : undefined,
      difference: row.difference ? parseFloat(row.difference) : undefined,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at
    };
  }

  /**
   * Open a new cash register
   * Business rules:
   * - User cannot have multiple open registers
   * - Creates initial "Apertura" movement
   * 
   * @param userId - ID of the user opening the register
   * @param openingBalance - Starting cash amount
   * @returns ID of the newly created register
   * @throws Error if user already has an open register
   */
  async openRegister(userId: string, openingBalance: number): Promise<string> {
    // Business rule: Check if user already has an open register
    const existing = await query(
      'SELECT * FROM cash_registers WHERE user_id = $1 AND status = \'abierta\'',
      [userId]
    );

    if (existing.rows.length > 0) {
      throw new Error('Ya tienes una caja abierta');
    }

    const registerId = crypto.randomUUID();

    // Create cash register record
    await query(
      'INSERT INTO cash_registers (id, user_id, opening_balance, status, opened_at) VALUES ($1, $2, $3, \'abierta\', NOW())',
      [registerId, userId, openingBalance]
    );

    // Create initial opening movement
    const movementId = crypto.randomUUID();
    await query(
      'INSERT INTO cash_movements (id, register_id, user_id, type, amount, concept, date) VALUES ($1, $2, $3, \'entrada\', $4, \'Apertura de caja\', NOW())',
      [movementId, registerId, userId, openingBalance]
    );

    return registerId;
  }

  /**
   * Close an open cash register
   * Calculates difference between expected and actual closing balance
   * 
   * @param userId - ID of the user closing the register
   * @param closingBalance - Actual cash counted at closing
   * @param expectedBalance - Expected cash based on movements
   * @returns void
   * @throws Error if no open register found
   */
  async closeRegister(
    userId: string,
    closingBalance: number,
    expectedBalance: number
  ): Promise<void> {
    const result = await query(
      'SELECT * FROM cash_registers WHERE user_id = $1 AND status = \'abierta\'',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('No tienes una caja abierta');
    }

    const registerId = result.rows[0].id;
    const difference = closingBalance - expectedBalance;

    await query(
      'UPDATE cash_registers SET status = \'cerrada\', closed_at = NOW(), closing_balance = $1, expected_balance = $2, difference = $3, closed_by_user_id = $4 WHERE id = $5',
      [closingBalance, expectedBalance, difference, userId, registerId]
    );
  }

  /**
   * Get all movements for the current open register
   * @param userId - ID of the user
   * @returns Array of cash movements
   */
  async getMovements(userId: string): Promise<CashMovement[]> {
    const registerResult = await query(
      'SELECT id FROM cash_registers WHERE user_id = $1 AND status = \'abierta\'',
      [userId]
    );

    if (registerResult.rows.length === 0) {
      return [];
    }

    const registerId = registerResult.rows[0].id;
    const movements = await query(
      'SELECT * FROM cash_movements WHERE register_id = $1 ORDER BY date DESC',
      [registerId]
    );

    return movements.rows.map((row: any) => ({
      id: row.id,
      registerId: row.register_id,
      userId: row.user_id,
      type: row.type,
      amount: parseFloat(row.amount),
      concept: row.concept,
      date: row.date
    }));
  }

  /**
   * Add a manual cash movement (income or expense)
   * @param userId - ID of the user
   * @param type - Type of movement ('entrada' or 'salida')
   * @param amount - Amount of money
   * @param concept - Description of the movement
   * @returns ID of the created movement
   * @throws Error if no open register found
   */
  async addMovement(
    userId: string,
    type: 'entrada' | 'salida',
    amount: number,
    concept: string
  ): Promise<string> {
    const registerResult = await query(
      'SELECT id FROM cash_registers WHERE user_id = $1 AND status = \'abierta\'',
      [userId]
    );

    if (registerResult.rows.length === 0) {
      throw new Error('No tienes una caja abierta');
    }

    const registerId = registerResult.rows[0].id;
    const movementId = crypto.randomUUID();

    await query(
      'INSERT INTO cash_movements (id, register_id, user_id, type, amount, concept, date) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [movementId, registerId, userId, type, amount, concept]
    );

    return movementId;
  }

  /**
   * Get history of closed cash registers
   * Includes user information for who opened and closed each register
   * @returns Array of closed cash registers with audit information
   */
  async getHistory(): Promise<CashRegister[]> {
    const result = await query(`
      SELECT 
        cr.*,
        u_opened.name as opened_by_name,
        u_closed.name as closed_by_name
      FROM cash_registers cr
      LEFT JOIN users u_opened ON cr.user_id = u_opened.id
      LEFT JOIN users u_closed ON cr.closed_by_user_id = u_closed.id
      WHERE cr.status = 'cerrada'
      ORDER BY cr.closed_at DESC
    `);

    return result.rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      openingBalance: parseFloat(row.opening_balance),
      closingBalance: row.closing_balance ? parseFloat(row.closing_balance) : undefined,
      expectedBalance: row.expected_balance ? parseFloat(row.expected_balance) : undefined,
      difference: row.difference ? parseFloat(row.difference) : undefined,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openedByName: row.opened_by_name,
      closedByName: row.closed_by_name
    }));
  }

  /**
   * Calculate if the cash difference is within acceptable range
   * Business rule: Difference < $0.01 is considered exact
   * @param difference - The calculated difference
   * @returns true if exact, false otherwise
   */
  isExactBalance(difference: number): boolean {
    return Math.abs(difference) < 0.01;
  }
}
