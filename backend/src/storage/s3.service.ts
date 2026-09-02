import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Upload } from '@aws-sdk/lib-storage'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import * as http from 'http'
import * as https from 'https'
import type { Readable } from 'stream'

// Tunable via env — sensible defaults for large file uploads
const PART_SIZE_BYTES = (Number(process.env.S3_PART_SIZE_MB) || 16) * 1024 * 1024
const QUEUE_SIZE = Number(process.env.S3_QUEUE_SIZE) || 8
const MAX_SOCKETS = Number(process.env.S3_MAX_SOCKETS) || 50

function buildRequestHandler(): NodeHttpHandler {
    const agentOptions = { keepAlive: true, maxSockets: MAX_SOCKETS }
    return new NodeHttpHandler({
        connectionTimeout: 5_000,
        socketTimeout: 120_000,
        httpAgent: new http.Agent(agentOptions),
        httpsAgent: new https.Agent(agentOptions),
    })
}

@Injectable()
export class S3StorageService implements OnModuleDestroy {
    private readonly client: S3Client
    private readonly bucket: string

    constructor() {
        const bucket = process.env.S3_BUCKET
        if (!bucket) throw new Error('S3_BUCKET is not set')

        this.bucket = bucket
        this.client = new S3Client({
            region: process.env.S3_REGION || 'us-east-1',
            endpoint: process.env.S3_ENDPOINT,
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
            credentials: process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
                ? {
                    accessKeyId: process.env.S3_ACCESS_KEY,
                    secretAccessKey: process.env.S3_SECRET_KEY,
                }
                : undefined,
            requestHandler: buildRequestHandler(),
            maxAttempts: 3,
        })
    }

    onModuleDestroy(): void {
        this.client.destroy()
    }

    async uploadJson(key: string, body: unknown): Promise<void> {
        const json = JSON.stringify(body)
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: json,
            ContentType: 'application/json',
        }))
    }

    async getJson<T = unknown>(key: string): Promise<T | null> {
        const res = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }))
        if (!res.Body) return null
        const chunks: Uint8Array[] = []
        for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk)
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
    }

    async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            ContentLength: buffer.length,
        }))
    }

    async uploadStream(key: string, stream: Readable, contentType: string): Promise<void> {
        const upload = new Upload({
            client: this.client,
            queueSize: QUEUE_SIZE,
            partSize: PART_SIZE_BYTES,
            leavePartsOnError: false,
            params: {
                Bucket: this.bucket,
                Key: key,
                Body: stream,
                ContentType: contentType,
            },
        })
        await upload.done()
    }

    async getObjectStream(key: string): Promise<Readable> {
        const res = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }))
        return res.Body as Readable
    }

    async deleteObject(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }))
    }

    async objectExists(key: string): Promise<boolean> {
        try {
            await this.client.send(new HeadObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }))
            return true
        } catch (err: any) {
            const status = err?.$metadata?.httpStatusCode
            if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
                return false
            }
            throw err
        }
    }

    async getPresignedPutUrl(key: string, contentType: string, expiresIn = 300): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
        })
        return getSignedUrl(this.client, command, { expiresIn })
    }
}
