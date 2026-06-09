import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: exception.message || 'Internal server error' };

    console.error('=================== 🔥 ERROR LOG ===================');
    console.error(`Timestamp: ${new Date().toISOString()}`);
    console.error(`Method/URL: ${request.method} ${request.url}`);
    
    // Log headers (useful for auth / custom headers debugging)
    console.error('Headers:', JSON.stringify(request.headers, null, 2));

    if (request.body) {
      console.error('Body:', JSON.stringify(request.body, null, 2));
    }
    
    console.error('Status Code:', status);
    console.error('Response Error:', JSON.stringify(responseBody, null, 2));
    
    if (exception.stack) {
      console.error('Stack Trace:', exception.stack);
    }
    console.error('====================================================');

    response.status(status).send(responseBody);
  }
}
