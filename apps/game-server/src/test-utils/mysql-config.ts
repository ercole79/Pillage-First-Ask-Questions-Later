import { getConfig } from '../config.ts';

export type TestMysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export const getTestMysqlConfig = (): TestMysqlConfig => {
  const config = getConfig({
    ...process.env,
    MYSQL_HOST: process.env.MYSQL_HOST ?? '127.0.0.1',
    MYSQL_PORT: process.env.MYSQL_PORT ?? '3306',
    MYSQL_USER: process.env.MYSQL_USER ?? 'pillage',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? 'pillage',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? 'pillage_online',
  });
  const { host, port, user, password, database } = config.mysql;
  return { host, port, user, password, database };
};

export const canReachMysql = async (
  config: TestMysqlConfig = getTestMysqlConfig(),
): Promise<boolean> => {
  try {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection(config);
    await connection.ping();
    await connection.end();
    return true;
  } catch {
    return false;
  }
};
