/** Connection strings shared by the round-trip and masking tests. */
export interface UriCase {
  name: string;
  uri: string;
  /** What `toConnectionString(parseConnectionString(uri))` writes; defaults to `uri`. */
  canonical?: string;
  /** Decoded secrets that `mask()` must hide. */
  secrets?: string[];
}

export const URI_CASES: UriCase[] = [
  { name: 'host only', uri: 'mongodb://localhost' },
  { name: 'host and port', uri: 'mongodb://localhost:27017' },
  {
    name: 'user, password and default database',
    uri: 'mongodb://user:pa55w0rd-one@localhost:27017/admin',
    secrets: ['pa55w0rd-one'],
  },
  {
    name: 'replica set seed list',
    uri: 'mongodb://a.example.com:27017,b.example.com:27018,c.example.com/?replicaSet=rs0',
  },
  {
    name: 'SRV with auth source, TLS, write concern and app name',
    uri: 'mongodb+srv://alice:s3cretSRV@cluster0.ab123.mongodb.net/test?authSource=admin&tls=true&w=majority&appName=Cluster0',
    secrets: ['s3cretSRV'],
  },
  {
    name: 'SRV with extra SRV options',
    uri: 'mongodb+srv://cluster1.example.net/?srvServiceName=customdb&srvMaxHosts=2',
  },
  { name: 'IPv6 loopback', uri: 'mongodb://[::1]:27017' },
  {
    name: 'IPv6 replica set with credentials',
    uri: 'mongodb://admin:ipv6Secret!@[2001:db8::1]:27017,[2001:db8::2]:27018,[2001:db8::3]/?replicaSet=rs1',
    secrets: ['ipv6Secret!'],
  },
  {
    name: 'percent-encoded credentials',
    uri: 'mongodb://user%40example.com:p%40ss%3Aw%2Frd%3F%23%25@db.example.com/inventory',
    secrets: ['p@ss:w/rd?#%'],
  },
  {
    name: 'non-ASCII credentials',
    uri: 'mongodb://j%C3%BCrgen:p%C3%A4ssw%C3%B6rd%E2%82%AC@localhost',
    secrets: ['pässwörd€'],
  },
  {
    name: 'X.509 with certificate files and key passphrase',
    uri: 'mongodb://CN%3Dclient%2COU%3Dusers%2CO%3DThicket@secure.example.com:27017/?authMechanism=MONGODB-X509&tls=true&tlsCAFile=/etc/ssl/ca.pem&tlsCertificateKeyFile=/etc/ssl/client.pem&tlsCertificateKeyFilePassword=keyPassphrase42',
    secrets: ['keyPassphrase42'],
  },
  {
    name: 'AWS IAM with session token',
    uri: 'mongodb+srv://AKIAEXAMPLE:awsSecretKey99@cluster.mongodb.net/?authSource=%24external&authMechanism=MONGODB-AWS&authMechanismProperties=AWS_SESSION_TOKEN:sessionTokenXYZ123',
    secrets: ['awsSecretKey99', 'sessionTokenXYZ123'],
  },
  {
    name: 'Kerberos with authMechanismProperties',
    uri: 'mongodb://user%40EXAMPLE.COM@kerberos.example.com/?authMechanism=GSSAPI&authMechanismProperties=SERVICE_NAME:mongodb,CANONICALIZE_HOST_NAME:true',
  },
  {
    name: 'OIDC with a property value containing colons',
    uri: 'mongodb://oidc.example.com/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api://thicket-app',
  },
  {
    name: 'LDAP (PLAIN) with $external',
    uri: 'mongodb://ldapuser:ldapPass77@ldap.example.com/?authSource=%24external&authMechanism=PLAIN',
    secrets: ['ldapPass77'],
  },
  {
    name: 'SCRAM-SHA-256 with auth source',
    uri: 'mongodb://app:scramPass256@localhost/?authSource=admin&authMechanism=SCRAM-SHA-256',
    secrets: ['scramPass256'],
  },
  {
    name: 'read preference with tag sets and max staleness',
    uri: 'mongodb://h1.example.com,h2.example.com/?replicaSet=rs&readPreference=secondaryPreferred&readPreferenceTags=dc:ny,rack:1&readPreferenceTags=dc:sf&readPreferenceTags=&maxStalenessSeconds=120',
  },
  {
    name: 'write concern',
    uri: 'mongodb://localhost/?w=2&journal=true&wtimeoutMS=5000',
  },
  { name: 'write concern tag', uri: 'mongodb://localhost/?w=dataCenterAware' },
  {
    name: 'all timeouts',
    uri: 'mongodb://localhost/?connectTimeoutMS=10000&serverSelectionTimeoutMS=5000&socketTimeoutMS=0&maxIdleTimeMS=60000&waitQueueTimeoutMS=1000&heartbeatFrequencyMS=10000&localThresholdMS=15&timeoutMS=30000',
  },
  {
    name: 'SOCKS5 proxy with credentials',
    uri: 'mongodb://dbuser:dbPassword1@internal.example.com/?proxyHost=socks.example.com&proxyPort=1080&proxyUsername=proxyuser&proxyPassword=proxyPass55',
    secrets: ['dbPassword1', 'proxyPass55'],
  },
  { name: 'direct connection', uri: 'mongodb://localhost:27018/?directConnection=true' },
  { name: 'load balanced', uri: 'mongodb://lb.example.com/?loadBalanced=true' },
  {
    name: 'TLS relaxed checks',
    uri: 'mongodb://localhost/?tls=true&tlsAllowInvalidCertificates=true&tlsAllowInvalidHostnames=true&tlsInsecure=false',
  },
  { name: 'Unix domain socket', uri: 'mongodb://%2Ftmp%2Fmongodb-27017.sock' },
  {
    name: 'unknown options',
    uri: 'mongodb://localhost/?retryWrites=false&compressors=zstd,snappy&zlibCompressionLevel=6',
  },
  { name: 'database name only', uri: 'mongodb://localhost/my-db' },
  { name: 'app name with spaces', uri: 'mongodb://localhost/?appName=Thicket%20Desktop' },
  // Not canonical on input: written back in Thicket's form, with the same meaning.
  {
    name: 'legacy ssl alias',
    uri: 'mongodb://localhost/?ssl=true',
    canonical: 'mongodb://localhost/?tls=true',
  },
  {
    name: 'legacy j and wtimeout aliases',
    uri: 'mongodb://localhost/?j=false&wtimeout=100',
    canonical: 'mongodb://localhost/?journal=false&wtimeoutMS=100',
  },
  {
    name: 'option keys in other case and order',
    uri: 'mongodb://localhost/?APPNAME=x&replicaset=rs&AuthSource=admin',
    canonical: 'mongodb://localhost/?replicaSet=rs&authSource=admin&appName=x',
  },
  {
    name: 'plus as space in the query',
    uri: 'mongodb://localhost/?appName=a+b',
    canonical: 'mongodb://localhost/?appName=a%20b',
  },
  {
    name: 'no slash before the query',
    uri: 'mongodb://localhost?w=1',
    canonical: 'mongodb://localhost/?w=1',
  },
  {
    name: 'surrounding whitespace',
    uri: '  mongodb://localhost:27017  ',
    canonical: 'mongodb://localhost:27017',
  },
];
