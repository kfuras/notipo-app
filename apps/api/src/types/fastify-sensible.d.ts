import "fastify";
import { Multipart, MultipartFile } from "@fastify/multipart";

// Patch @fastify/sensible and @fastify/multipart type augmentations
// for fastify 5.8.1+ which changed FastifyReply/FastifyRequest generics.
declare module "fastify" {
  interface FastifyRequest {
    file(): Promise<MultipartFile | undefined>;
    files(): AsyncIterableIterator<MultipartFile>;
    parts(): AsyncIterableIterator<Multipart>;
  }

  interface FastifyReply {
    badRequest(msg?: string): FastifyReply;
    unauthorized(msg?: string): FastifyReply;
    forbidden(msg?: string): FastifyReply;
    notFound(msg?: string): FastifyReply;
    conflict(msg?: string): FastifyReply;
    gone(msg?: string): FastifyReply;
    internalServerError(msg?: string): FastifyReply;
    notImplemented(msg?: string): FastifyReply;
    badGateway(msg?: string): FastifyReply;
    serviceUnavailable(msg?: string): FastifyReply;
    gatewayTimeout(msg?: string): FastifyReply;
    methodNotAllowed(msg?: string): FastifyReply;
    notAcceptable(msg?: string): FastifyReply;
    requestTimeout(msg?: string): FastifyReply;
    lengthRequired(msg?: string): FastifyReply;
    preconditionFailed(msg?: string): FastifyReply;
    payloadTooLarge(msg?: string): FastifyReply;
    uriTooLong(msg?: string): FastifyReply;
    unsupportedMediaType(msg?: string): FastifyReply;
    rangeNotSatisfiable(msg?: string): FastifyReply;
    expectationFailed(msg?: string): FastifyReply;
    imateapot(msg?: string): FastifyReply;
    unprocessableEntity(msg?: string): FastifyReply;
    locked(msg?: string): FastifyReply;
    failedDependency(msg?: string): FastifyReply;
    tooEarly(msg?: string): FastifyReply;
    upgradeRequired(msg?: string): FastifyReply;
    preconditionRequired(msg?: string): FastifyReply;
    tooManyRequests(msg?: string): FastifyReply;
    requestHeaderFieldsTooLarge(msg?: string): FastifyReply;
    unavailableForLegalReasons(msg?: string): FastifyReply;
    getHttpError(code: number | string, message?: string): FastifyReply;
  }
}
