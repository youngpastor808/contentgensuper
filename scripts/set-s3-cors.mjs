/**
 * Sets the CORS rule the Remotion cloud render needs on the S3 media bucket.
 *
 * Why: overlay images (evidence boards, custom icons, social avatars...) are loaded onto a <canvas> with
 * `crossOrigin = "anonymous"` inside the Remotion page. S3 only serves such images if the bucket sends
 * `Access-Control-Allow-Origin`; otherwise the image fails to load and the overlay renders without it.
 *
 * Usage (needs s3:PutBucketCORS for the IAM user):
 *   AWS_REGION=us-east-1 AWS_S3_MEDIA_BUCKET=my-bucket node scripts/set-s3-cors.mjs
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const bucket = process.env.AWS_S3_MEDIA_BUCKET || process.env.S3_BUCKET;
const region = process.env.AWS_REGION || process.env.REMOTION_AWS_REGION || 'us-east-1';
if (!bucket) {
  console.error('Set AWS_S3_MEDIA_BUCKET (or S3_BUCKET) to the media bucket name.');
  process.exit(1);
}

const client = new S3Client({ region });
await client.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedMethods: ['GET', 'HEAD'],
      AllowedOrigins: ['*'],          // assets are presigned URLs; tighten to your Remotion site origin if you prefer
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
      MaxAgeSeconds: 3600,
    }],
  },
}));
const check = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`CORS set on s3://${bucket} (${region}):`, JSON.stringify(check.CORSRules));
console.log('\nVerify with:\n  curl -sI -H "Origin: https://example.com" "<a presigned asset URL>" | grep -i access-control');
