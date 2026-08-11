/**
 * Logger estruturado para o Estoque TEEP
 * 
 * Para sistema interno, mantemos simples mas estruturado.
 * Em produção, logs são enviados para console (coletados pelo Docker).
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
type LogContext = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  service: 'teep-api';
}

class Logger {
  private service: 'teep-api' = 'teep-api';
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug') {
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };
    return levels[level] <= levels[this.minLevel];
  }

  /**
   * Sanitiza mensagem para prevenir log injection
   * Remove caracteres de nova linha e trim
   */
  public sanitizeMessage(message: string): string {
    // Remove caracteres de nova linha para prevenir log injection
    return message.replace(/[\r\n]/g, ' ').trim();
  }

  /**
   * Sanitiza contexto para prevenir log injection
   */
  public sanitizeContext(context?: LogContext): LogContext | undefined {
    if (!context) return undefined;
    
    const sanitized: LogContext = {};
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeMessage(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private format(level: LogLevel, message: string, context?: LogContext): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      service: this.service,
    };

    // Em desenvolvimento, mostramos mais legível
    if (process.env.NODE_ENV !== 'production') {
      const time = new Date().toLocaleTimeString('pt-BR');
      const ctx = context ? ` ${JSON.stringify(context)}` : '';
      return `[${time}] ${level.toUpperCase()}: ${message}${ctx}`;
    }

    // Em produção, JSON estruturado
    return JSON.stringify(entry);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;
    
    const formatted = this.format(level, message, context);
    
    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  error(message: string, context?: LogContext): void {
    this.log('error', this.sanitizeMessage(message), this.sanitizeContext(context));
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', this.sanitizeMessage(message), this.sanitizeContext(context));
  }

  info(message: string, context?: LogContext): void {
    this.log('info', this.sanitizeMessage(message), this.sanitizeContext(context));
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', this.sanitizeMessage(message), this.sanitizeContext(context));
  }

  // Métodos específicos do domínio
  auth(message: string, userId?: string, context?: LogContext): void {
    this.info(`[AUTH] ${this.sanitizeMessage(message)}`, { userId, ...this.sanitizeContext(context) });
  }

  movimento(message: string, movimentoId?: string, produtoId?: string, context?: LogContext): void {
    this.info(`[MOVIMENTO] ${this.sanitizeMessage(message)}`, { movimentoId, produtoId, ...this.sanitizeContext(context) });
  }

  transferencia(message: string, transferenciaId?: string, context?: LogContext): void {
    this.info(`[TRANSFERENCIA] ${this.sanitizeMessage(message)}`, { transferenciaId, ...this.sanitizeContext(context) });
  }

  rma(message: string, processoId?: string, context?: LogContext): void {
    this.info(`[RMA] ${this.sanitizeMessage(message)}`, { processoId, ...this.sanitizeContext(context) });
  }

  startup(message: string, context?: LogContext): void {
    this.info(`[STARTUP] ${this.sanitizeMessage(message)}`, this.sanitizeContext(context));
  }

  shutdown(message: string, context?: LogContext): void {
    this.info(`[SHUTDOWN] ${this.sanitizeMessage(message)}`, this.sanitizeContext(context));
  }
}

// Singleton global
export const logger = new Logger();

// Helper para criar logger com contexto
export function createLogger(context: LogContext = {}): Logger & { withContext: (additional: LogContext) => any } {
  const baseLogger = new Logger();
  
  return {
    ...baseLogger,
    withContext(additional: LogContext) {
      return createLogger({ ...context, ...additional });
    },
  } as any;
}

// Exportar tipos
export type { Logger, LogLevel, LogContext };
