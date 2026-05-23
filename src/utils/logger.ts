type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFormat = 'json' | 'pretty';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  data?: unknown;
}

class Logger {
  private minLevel: LogLevel;
  private format: LogFormat;
  private context: string;

  constructor(context: string) {
    this.context = context;
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.format = (process.env.LOG_FORMAT as LogFormat) || 'pretty';
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: this.context,
      ...(data !== undefined && { data }),
    };

    if (this.format === 'json') {
      const output = JSON.stringify(entry);
      if (level === 'error') {
        process.stderr.write(output + '\n');
      } else {
        process.stdout.write(output + '\n');
      }
      return;
    }

    const color = LEVEL_COLORS[level];
    const prefix = `${color}[${level.toUpperCase()}]${RESET}`;
    const ctx = this.context ? `\x1b[90m${this.context}\x1b[0m` : '';
    const ts = `\x1b[90m${entry.timestamp}\x1b[0m`;

    let line = `${ts} ${prefix} ${ctx ? ctx + ' ' : ''}${message}`;
    if (data !== undefined) {
      line += ' ' + (typeof data === 'object' ? JSON.stringify(data) : String(data));
    }

    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else if (level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}
