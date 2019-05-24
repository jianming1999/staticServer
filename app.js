let config = require('./config'),
	path = require('path'),
	fs = require('fs'),
	mime = require('mime'),
	chalk = require('chalk'),
	util = require('util'),
	url = require('url'),
	http = require('http'),
	zlib = require('zlib'),
	stat = util.promisify(fs.stat),
	debug = require('debug')('staticServer'),
	ejs = require('ejs'),
	tmpl = fs.readFileSync(path.join(__dirname, '/src/tmpl.ejs'), 'utf8'),
    readDir = util.promisify(fs.readdir);
debug('staticServer start ...');
class Server {
	constructor(){
		this.config = config;
		this.tmpl = tmpl;
	}
	// 读取文件,并返回响应内容
	sendFile(req, res, filePath, statObj){
		// 缓存
		if(this.cache(req, res, statObj)) return;
		// 压缩
		let s = this.compress(req, res, filePath, statObj);	
		// 范围请求
		let {start, end} = this.range(req, res, statObj);
		// 设置文件类型
		res.setHeader('Content-Type', mime.getType(filePath)+ ';charset=UTF-8');
		let rs = fs.createReadStream(filePath, {start, end});
		// 如果支持压缩，就应用压缩并返回压缩处理后的文件流
		if(s){
			rs.pipe(s).pipe(res);
		}
		// 如果不支持就直接返回原始文件流
		else{
			rs.pipe(res);
		}
	}
	// 失败404
	sendError(req, res, e){
		debug(util.inspect(e).toString());
		res.statusCode = 404;
		res.end();
	}
	// 缓存
	cache(req, res, statObj){
		// 强制缓存(from memory cache：来源于本地缓存，不会向服务器发送请求,html除外)
		// Cache-Control

		// 协商缓存(还是会向服务器发起请求，只是不用触发IO操作，返回304状态码)
		// Etag	if-none-match
		// Last-Modified if-modified-since
		// ifNoneMatch一般是内容的md5戳=> ctime+size
		let ifNoneMatch = req.headers['if-none-match'],
			// ifModifiedSince 文件的最新修改时间
			ifModifiedSince = req.headers['if-modified-since'],
			since = statObj.ctime.toUTCString(),
			etag = new Date(since).getTime() + '-' + statObj.size;
		// 10秒之内强制缓存
		res.setHeader('Cache-Control', 'max-age=10');
		res.setHeader('Etag', etag);
		res.setHeader('Last-Modified', since);
		if(ifNoneMatch !== etag){
			return false;
		}
		if(ifModifiedSince !== since){
			return false;
		}
		// console.log('304');
		res.statusCode = 304;
		res.end();
		return true;
	}
	// 压缩
	compress(req, res, statObj){
		// Accept-Encoding: gzip,deflate,br
		// Content-Encoding: gzip
		let header = req.headers['accept-encoding'];
		if(header){
			// 如果浏览器支持gzip
			if(header.match(/\bgzip\b/)){
				res.setHeader('Content-Encoding', 'gzip');
				return zlib.createGzip();
			}
			// 如果浏览器支持deflate
			else if(header.match(/\bdeflate\b/)){
				res.setHeader('Content-Encoding', 'deflate');
				return zlib.createDeflate();
			}
			// 其他情况暂不支持
			else{
				return false;
			}
		}
		else{
			return false;
		}
	}
	// 范围请求
	range(req, res, statObj){
		// 范围请求的请求头(request header)：Range: bytes=1-100
		// 服务器响应头 (response header): Accept-Ranges: bytes 1-100/${total}
		// 服务器响应头（response header): Content-ranges: bytes
		// 获取浏览器发送过来的请求头range 
		let header = req.headers['range'],
		// header => bytes=1-100
		start = 0,
		// 整个文件的大小
		end = statObj.size;

		if(header){
			// 获取range中的范围start,end
		    let [,s,e] = header.match(/bytes=(\d*)-(\d*)/);
			start = s ? parseInt(s) : start;
			end = s ? parseInt(e) : end;
			// 告诉浏览器支持range的方式是bytes，如果不支持可设置为none
			res.setHeader('Content-Range', 'bytes');
            // 告诉浏览器我将会发送给你想要的范围数据和总大小			
   			res.setHeader('Accept-Ranges', `bytes ${start}-${end}/${statObj.size}`);
		}
		console.log(`[range] start:${start} end:${end-1}`);
		// 因为start是从0开始
		return {start, end: end-1};
	}
	// 请求处理
	handleRequest(){
		return async(req, res) => {
			let {pathname} = url.parse(req.url, true),
				filePath = path.join(this.config.dir, '.' + pathname);
			
			try{
				let statObj = await stat(filePath);
				// 如果是目录
				if(statObj.isDirectory()){
					let dirs = await readDir(filePath);
					debug(dirs);
					dirs = dirs.map(dir => ({
						path: path.join(pathname, dir),
						name: dir
					}));	
					let content = ejs.render(this.tmpl, {dirs})
					res.setHeader('Content-Type', 'text/html;charset=utf8');
					res.end(content);
				}
				// 如果是文件
				else{
					console.log('filePath:', filePath);
					// 发送文件						
					this.sendFile(req, res, filePath, statObj);
				}

			}catch(e){
				this.sendError(req, res, filePath);
			}
		}
	}
	// 开始
	start(){
		let {port, hostname} = this.config,
			server = http.createServer(this.handleRequest()),
			url = `http://${hostname}:${chalk.green(port)}`;
		debug(url);
		// 监听服务端口
		server.listen(port, hostname);
	}
}
let server = new Server();
server.start();
