/**
 * 数据库适配器
 * 提供统一的接口，可以在KV、D1和远程PostgreSQL之间切换
 * 
 * 修改版 - 添加了 RemoteDBAdapter 支持
 * 小亚为主人写的～♡
 */

import { D1Database } from './d1Database.js';

function normalizeEnvValue(value) {
    if (typeof value === 'string') {
        return value.trim();
    }

    if (value && typeof value === 'object') {
        if (typeof value.value === 'string') return value.value.trim();
        if (typeof value.secret === 'string') return value.secret.trim();
        if (typeof value.text === 'string') return value.text.trim();
    }

    return '';
}

function getEnvString(env, keys) {
    for (const key of keys) {
        const candidate = normalizeEnvValue(env && env[key]);
        if (candidate) return candidate;
    }

    if (typeof process !== 'undefined' && process && process.env) {
        for (const key of keys) {
            const candidate = normalizeEnvValue(process.env[key]);
            if (candidate) return candidate;
        }
    }

    return '';
}

function getRemoteDbUrl(env) {
    return getEnvString(env, ['REMOTE_DB_URL']);
}

function getRemoteDbApiKey(env) {
    return getEnvString(env, [
        'REMOTE_DB_API_KEY',
        'REMOTE_DB_APIKEY',
        'REMOTE_DB_KEY',
        'REMOTE_DB_API_SECRET',
        'REMOTE_DB_API_TOKEN',
        'REMOTE_DB_TOKEN'
    ]);
}

/**
 * 创建数据库适配器
 * @param {Object} env - 环境变量
 * @returns {Object} 数据库适配器实例
 */
export function createDatabaseAdapter(env) {
    const remoteDbUrl = getRemoteDbUrl(env);
    const remoteDbApiKey = getRemoteDbApiKey(env);

    // 优先使用远程 PostgreSQL 数据库
    if (remoteDbUrl && remoteDbApiKey) {
        console.log('Using Remote PostgreSQL database');
        return new RemoteDBAdapter(remoteDbUrl, remoteDbApiKey);
    }
    
    // 检查是否配置了本地数据库
    if (env.img_url && typeof env.img_url.get === 'function') {
        // 使用KV存储
        return new KVAdapter(env.img_url);
    } else if (env.img_d1 && typeof env.img_d1.prepare === 'function') {
        // 使用D1数据库
        return new D1Database(env.img_d1);
    } else {
        console.error('No database configured. Please configure either KV (env.img_url), D1 (env.img_d1), or Remote DB (env.REMOTE_DB_URL).');
        return null;
    }
}

/**
 * 远程数据库适配器类
 * 通过 HTTP API 调用本地 PostgreSQL 服务
 */
class RemoteDBAdapter {
    constructor(apiUrl, apiKey) {
        this.apiUrl = apiUrl.replace(/\/$/, ''); // 移除末尾斜杠
        this.apiKey = apiKey;
    }

    _arrayBufferToBase64(arrayBuffer) {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(arrayBuffer).toString('base64');
        }

        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    _base64ToArrayBuffer(base64) {
        if (typeof Buffer !== 'undefined') {
            const buf = Buffer.from(base64, 'base64');
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }

        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    _encodeValue(value) {
        if (value instanceof ArrayBuffer) {
            return {
                __cfdb_type: 'arrayBuffer',
                base64: this._arrayBufferToBase64(value)
            };
        }

        if (ArrayBuffer.isView(value)) {
            const viewBuffer = value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength
            );
            return {
                __cfdb_type: 'arrayBuffer',
                base64: this._arrayBufferToBase64(viewBuffer)
            };
        }

        return value;
    }

    _decodeValue(value, options) {
        const wantArrayBuffer = options && options.type === 'arrayBuffer';
        if (!wantArrayBuffer) {
            return value;
        }

        if (value == null) {
            return value;
        }

        if (
            typeof value === 'object' &&
            value.__cfdb_type === 'arrayBuffer' &&
            typeof value.base64 === 'string'
        ) {
            return this._base64ToArrayBuffer(value.base64);
        }

        if (typeof value === 'string') {
            return new TextEncoder().encode(value).buffer;
        }

        return value;
    }

    async _fetch(endpoint, body) {
        const response = await fetch(`${this.apiUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.apiKey
            },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Remote DB API error: ${response.status} - ${errorText}`);
        }
        
        return response.json();
    }

    // 通用方法
    async put(key, value, options) {
        return this._fetch('/api/put', {
            key,
            value: this._encodeValue(value),
            options
        });
    }

    async get(key, options) {
        const result = await this._fetch('/api/get', { key, options });
        return this._decodeValue(result.value, options);
    }

    async getWithMetadata(key, options) {
        const result = await this._fetch('/api/getWithMetadata', { key, options });
        if (result && Object.prototype.hasOwnProperty.call(result, 'value')) {
            result.value = this._decodeValue(result.value, options);
        }
        return result;
    }

    async delete(key) {
        return this._fetch('/api/delete', { key });
    }

    async list(options) {
        return this._fetch('/api/list', options || {});
    }

    // 文件操作别名
    async putFile(fileId, value, options) {
        return this.put(fileId, value, options);
    }

    async getFile(fileId, options) {
        return this.getWithMetadata(fileId, options);
    }

    async getFileWithMetadata(fileId, options) {
        return this.getWithMetadata(fileId, options);
    }

    async deleteFile(fileId) {
        return this.delete(fileId);
    }

    async listFiles(options) {
        return this.list(options);
    }

    // 设置操作别名
    async putSetting(key, value) {
        return this.put(key, value);
    }

    async getSetting(key, options) {
        return this.get(key, options);
    }

    async deleteSetting(key) {
        return this.delete(key);
    }

    async listSettings(options) {
        return this.list(options);
    }

    // 索引操作
    async putIndexOperation(operationId, operation) {
        const key = 'manage@index@operation_' + operationId;
        return this.put(key, JSON.stringify(operation));
    }

    async getIndexOperation(operationId) {
        const key = 'manage@index@operation_' + operationId;
        const result = await this.get(key);
        return result ? JSON.parse(result) : null;
    }

    async deleteIndexOperation(operationId) {
        const key = 'manage@index@operation_' + operationId;
        return this.delete(key);
    }

    async listIndexOperations(options) {
        const listOptions = Object.assign({}, options, {
            prefix: 'manage@index@operation_'
        });
        const result = await this.list(listOptions);
        
        const operations = [];
        for (const item of result.keys) {
            operations.push({
                id: item.name.replace('manage@index@operation_', '')
            });
        }
        
        return operations;
    }
}

/**
 * KV适配器类
 * 保持与原有KV接口的兼容性
 */
class KVAdapter {
    constructor(kv) {
        this.kv = kv;
    }

    // 直接代理到KV的方法
    async put(key, value, options) {
        options = options || {};
        return await this.kv.put(key, value, options);
    }

    async get(key, options) {
        options = options || {};
        return await this.kv.get(key, options);
    }

    async getWithMetadata(key, options) {
        options = options || {};
        return await this.kv.getWithMetadata(key, options);
    }

    async delete(key, options) {
        options = options || {};
        return await this.kv.delete(key, options);
    }

    async list(options) {
        options = options || {};
        return await this.kv.list(options);
    }

    // 为了兼容性，添加一些别名方法
    async putFile(fileId, value, options) {
        return await this.put(fileId, value, options);
    }

    async getFile(fileId, options) {
        const result = await this.getWithMetadata(fileId, options);
        return result;
    }

    async getFileWithMetadata(fileId, options) {
        return await this.getWithMetadata(fileId, options);
    }

    async deleteFile(fileId, options) {
        return await this.delete(fileId, options);
    }

    async listFiles(options) {
        return await this.list(options);
    }

    async putSetting(key, value, options) {
        return await this.put(key, value, options);
    }

    async getSetting(key, options) {
        return await this.get(key, options);
    }

    async deleteSetting(key, options) {
        return await this.delete(key, options);
    }

    async listSettings(options) {
        return await this.list(options);
    }

    async putIndexOperation(operationId, operation, options) {
        const key = 'manage@index@operation_' + operationId;
        return await this.put(key, JSON.stringify(operation), options);
    }

    async getIndexOperation(operationId, options) {
        const key = 'manage@index@operation_' + operationId;
        const result = await this.get(key, options);
        return result ? JSON.parse(result) : null;
    }

    async deleteIndexOperation(operationId, options) {
        const key = 'manage@index@operation_' + operationId;
        return await this.delete(key, options);
    }

    async listIndexOperations(options) {
        const listOptions = Object.assign({}, options, {
            prefix: 'manage@index@operation_'
        });
        const result = await this.list(listOptions);
        
        // 转换格式以匹配D1Database的返回格式
        const operations = [];
        for (const item of result.keys) {
            const operationData = await this.get(item.name);
            if (operationData) {
                const operation = JSON.parse(operationData);
                operations.push({
                    id: item.name.replace('manage@index@operation_', ''),
                    type: operation.type,
                    timestamp: operation.timestamp,
                    data: operation.data,
                    processed: false // KV中没有这个字段，默认为false
                });
            }
        }
        
        return operations;
    }
}

/**
 * 获取数据库实例的便捷函数
 * 这个函数可以在整个应用中使用，确保一致的数据库访问
 * @param {Object} env - 环境变量
 * @returns {Object} 数据库实例
 */
export function getDatabase(env) {
    var adapter = createDatabaseAdapter(env);
    if (!adapter) {
        throw new Error('Database not configured. Please configure D1 database (env.img_d1), KV storage (env.img_url), or Remote DB (env.REMOTE_DB_URL).');
    }
    return adapter;
}

/**
 * 检查数据库配置
 * @param {Object} env - 环境变量
 * @returns {Object} 配置信息
 */
export function checkDatabaseConfig(env) {
    var hasD1 = env.img_d1 && typeof env.img_d1.prepare === 'function';
    var hasKV = env.img_url && typeof env.img_url.get === 'function';
    var hasRemote = !!(getRemoteDbUrl(env) && getRemoteDbApiKey(env));

    return {
        hasD1: hasD1,
        hasKV: hasKV,
        hasRemote: hasRemote,
        usingRemote: hasRemote,
        usingD1: !hasRemote && hasD1,
        usingKV: !hasRemote && !hasD1 && hasKV,
        configured: hasD1 || hasKV || hasRemote
    };
}
