/**
 * Extracted from a real-world production backend.
 * Originally part of a monolithic Express + PostgreSQL application.
 * Refactored and shared for portfolio demonstration purposes.
 */
//auth.middleware.ts

import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_change_me';

/**
 * JWT payload structure after verification
 */
interface JwtPayload {
  id: string;
  email: string;
  role: string;
  name: string;
}

/**
 * Extended Express Request with authenticated user data
 */
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Middleware to authenticate JWT tokens from Authorization header
 * 
 * Verifies the Bearer token and attaches the decoded user payload to req.user
 * Returns 401 if token is missing, 403 if token is invalid or expired
 * 
 * @example
 * app.get('/api/protected', authenticateToken, (req: AuthenticatedRequest, res) => {
 *   console.log('User ID:', req.user?.id);
 *   res.json({ message: 'Authorized' });
 * });
 */
export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract Bearer token

  if (!token) {
    res.sendStatus(401); // Unauthorized - No token provided
    return;
  }

  jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
    if (err) {
      res.sendStatus(403); // Forbidden - Invalid or expired token
      return;
    }

    req.user = decoded as JwtPayload;
    next();
  });
};

/**
 * Optional: Role-based authorization middleware
 * Use after authenticateToken to restrict access by role
 * 
 * @param allowedRoles - Array of roles that can access the route
 * 
 * @example
 * app.delete('/api/users/:id',
 *   authenticateToken,
 *   requireRole(['admin']),
 *   deleteUserHandler
 * );
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.sendStatus(401);
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: 'Acceso denegado: permisos insuficientes' });
      return;
    }

    next();
  };
};
