///<reference path='typescript.ts'/>
///<reference path='io.ts'/>
///<reference path='optionsParser.ts'/>

class CommandLineHost implements TypeScript.IResolverHost {

    public pathMap: any = {};
    public resolvedPaths: any = {};

    public isResolved(path: string) {
        return this.resolvedPaths[this.pathMap[path]] != undefined;
    }

    public resolveCompilationEnvironment(preEnv: TypeScript.CompilationEnvironment,
        resolver: TypeScript.ICodeResolver,
        traceDependencies: bool): TypeScript.CompilationEnvironment {
        var resolvedEnv = new TypeScript.CompilationEnvironment(preEnv.compilationSettings, preEnv.ioHost);

        var nCode = preEnv.code.length;
        var nRCode = preEnv.residentCode.length;

        var postResolutionError = 
            (errorFile: string, errorMessage: string) => {
                TypeScript.CompilerDiagnostics.debugPrint("Could not resolve file '" + errorFile + "'" + (errorMessage == "" ? "" : ": " + errorMessage));
            }

        var resolutionDispatcher: TypeScript.IResolutionDispatcher = {
            postResolutionError: postResolutionError,
            postResolution: (path: string, code: TypeScript.ISourceText) => {
                if (!this.resolvedPaths[path]) {
                    resolvedEnv.code.push(<TypeScript.SourceUnit>code);
                    this.resolvedPaths[path] = true;
                }
            }
        };

        var residentResolutionDispatcher: TypeScript.IResolutionDispatcher = {
            postResolutionError: postResolutionError,
            postResolution: (path: string, code: TypeScript.ISourceText) => {
                if (!this.resolvedPaths[path]) {
                    resolvedEnv.residentCode.push(<TypeScript.SourceUnit>code);
                    this.resolvedPaths[path] = true;
                }
            }
        };
        var path = "";

        for (var i = 0; i < nRCode; i++) {
            path = TypeScript.switchToForwardSlashes(preEnv.ioHost.resolvePath(preEnv.residentCode[i].path));
            this.pathMap[preEnv.residentCode[i].path] = path;
            resolver.resolveCode(path, "", false, residentResolutionDispatcher);
        }

        for (var i = 0; i < nCode; i++) {
            path = TypeScript.switchToForwardSlashes(preEnv.ioHost.resolvePath(preEnv.code[i].path));
            this.pathMap[preEnv.code[i].path] = path;
            resolver.resolveCode(path, "", false, resolutionDispatcher);
        }

        return resolvedEnv;
    }
}
class BatchCompiler {
    public compilationSettings: TypeScript.CompilationSettings;
    public compilationEnvironment: TypeScript.CompilationEnvironment;
    public commandLineHost = new CommandLineHost();
    public resolvedEnvironment: TypeScript.CompilationEnvironment = null;

    constructor (public ioHost: IIO) { 
        this.compilationSettings = new TypeScript.CompilationSettings();
        this.compilationEnvironment = new TypeScript.CompilationEnvironment(this.compilationSettings, this.ioHost);
    }

    public resolve() {
        var resolver = new TypeScript.CodeResolver(this.compilationEnvironment);
        var ret = this.commandLineHost.resolveCompilationEnvironment(this.compilationEnvironment, resolver, true);

        for (var i = 0; i < this.compilationEnvironment.residentCode.length; i++) {
            if (!this.commandLineHost.isResolved(this.compilationEnvironment.residentCode[i].path)) {
                this.ioHost.stderr.WriteLine("Error reading file \"" + this.compilationEnvironment.residentCode[i].path + "\": File not found");
            }
        }
        for (var i = 0; i < this.compilationEnvironment.code.length; i++) {
            if (!this.commandLineHost.isResolved(this.compilationEnvironment.code[i].path)) {
                this.ioHost.stderr.WriteLine("Error reading file \"" + this.compilationEnvironment.code[i].path + "\": File not found");
            }
        }

        return ret;
    }
    
    /// Do the actual compilation reading from input files and
    /// writing to output file(s).
    public compile() {
        if (this.compilationSettings.outputFileName) {
            this.compilationSettings.outputFileName = TypeScript.switchToForwardSlashes(this.ioHost.resolvePath(this.compilationSettings.outputFileName));
        }
        var outfile: ITextWriter = this.compilationSettings.outputFileName ? this.ioHost.createFile(this.compilationSettings.outputFileName) : null;
        var compiler: TypeScript.TypeScriptCompiler;
        // initialize to avoid definite assignment warning
        var errout: ITextWriter = null;

        if (this.compilationSettings.errorFileName) {
            errout = this.ioHost.createFile(this.compilationSettings.errorFileName);
            compiler = new TypeScript.TypeScriptCompiler(outfile, errout, new TypeScript.NullLogger(), this.compilationSettings);
            compiler.setErrorOutput(errout);
        } else {
            compiler = new TypeScript.TypeScriptCompiler(outfile, outfile, new TypeScript.NullLogger(), this.compilationSettings);
            compiler.setErrorOutput(this.ioHost.stderr);
            compiler.setErrorCallback(
                (minChar, charLen, message, unitIndex) => {
                    compiler.errorReporter.hasErrors = true;
                    var fname = this.resolvedEnvironment.code[unitIndex].path;
                    var msg = fname + " (" + compiler.parser.scanner.line + "," + compiler.parser.scanner.col + "): " + message;
                    if (this.compilationSettings.errorRecovery) {
                        this.ioHost.stderr.WriteLine(msg);
                    } else {
                        throw new SyntaxError(msg);
                    }
                });
        }

        if (this.compilationSettings.emitComments) {
            compiler.emitCommentsToOutput();
        }

        var consumeUnit = (code: TypeScript.SourceUnit, addAsResident: bool) => {
            try {
                // if file resolving is disabled, the file's content will not yet be loaded

                if (!this.compilationSettings.resolve) {
                    code.content = this.ioHost.readFile(code.path);
                }

                if (code.content != null) {
                    if (this.compilationSettings.parseOnly) {
                        compiler.parseUnit(code.content, code.path);
                    }
                    else {
                        if (this.compilationSettings.errorRecovery) {
                            compiler.parser.setErrorRecovery(outfile, -1, -1);
                        }
                        compiler.addUnit(code.content, code.path, addAsResident);
                    }
                }
            }
            catch (err) {
                compiler.errorReporter.hasErrors = true;
                // This includes syntax errors thrown from error callback if not in recovery mode
                if (errout != null)
                    errout.WriteLine(err.message)
                else
                    this.ioHost.stderr.WriteLine(err.message);
            }

        }

        for (var iResCode = 0 ; iResCode < this.resolvedEnvironment.residentCode.length; iResCode++) {
            if (!this.compilationSettings.parseOnly) {
                consumeUnit(this.resolvedEnvironment.residentCode[iResCode], true);
            }
        }

        for (var iCode = 0 ; iCode < this.resolvedEnvironment.code.length; iCode++) {
            if (!this.compilationSettings.parseOnly || (iCode > 0)) {
                consumeUnit(this.resolvedEnvironment.code[iCode], false);
            }
        }

        if (!this.compilationSettings.parseOnly) {
            compiler.typeCheck();
            if (this.compilationSettings.generateDeclarationFiles && compiler.errorReporter.hasErrors) {
                // There were errors reported, do not generate declaration file
                this.compilationSettings.generateDeclarationFiles = false;
            }

            try {
                compiler.emit(this.compilationSettings.outputMany, this.ioHost.createFile);
            } catch (err) {
                // Catch emitter exceptions
                if (err.message != "EmitError") {
                    throw err;
                }
            }
        }

        if (outfile) {
            outfile.Close();
        }

        if (errout) {
            errout.Close();
        }

        if (compiler.errorReporter.hasErrors) {
            this.ioHost.quit(1);
        }
    }

    // Execute the provided inputs
    public run() {
        for (var i = 0; i < this.compilationEnvironment.code.length; i++) {
            var unit = this.compilationEnvironment.code[i];
            
            var outputFileName: string = unit.path;
            if (TypeScript.isTSCFile(outputFileName)) {
                outputFileName = outputFileName.replace(/\.ts$/, ".js");
            } else if (TypeScript.isSTRFile(outputFileName)) {
                outputFileName = outputFileName.replace(/\.str$/, ".js");
            }
            if (this.ioHost.fileExists(outputFileName)) {
                var unitRes = this.ioHost.readFile(outputFileName)
                this.ioHost.run(unitRes, outputFileName);
            }
        }
    }

    /// Begin batch compilation
    public batchCompile() {
        TypeScript.CompilerDiagnostics.diagnosticWriter = { Alert: (s: string) => { this.ioHost.printLine(s); } }

        var code: TypeScript.SourceUnit;

        var opts = new OptionsParser(this.ioHost);

        opts.option('out', {
            usage: 'File to create',
            type: 'file',
            set: (str) => {
                this.compilationSettings.outputOne(str);
            }
        });

        opts.option('err', {
            usage: 'File to send error messages to',
            type: 'file',
            set: (str) => {
                this.compilationSettings.errorFileName = str;
            }
        });

        opts.option('style', {
            usage: 'Select style checking options (examples --style requireSemi:off or --style "eqeqeq;bitwise:off")',
            experimental: true,
            set: (str) => {
                this.compilationSettings.setStyleOptions(str);
            }
        });
        opts.flag('map', {
            usage: 'Generates corresponding .map file',
            experimental: true,
            set: () => {
                this.compilationSettings.mapSourceFiles = true;
            }
        });

        opts.flag('generatedeclarations', {
            usage: 'Generates corresponding .d.str file',
            set: () => {
                this.compilationSettings.generateDeclarationFiles = true;
            }
        });

        opts.option('reference', {
            usage: 'Add a reference to the compilation',
            type: 'file',
            set: (str) => {
                code = new TypeScript.SourceUnit(str, null);
                this.compilationEnvironment.residentCode.push(code);
            }
        }, 'r');

        opts.flag('watch', {
            usage: 'Watch output files',
            set: () => {
                this.compilationSettings.watch = true;
            }
        }, 'w');

        opts.flag('exec', {
            usage: 'Execute the script after compilation',
            set: () => {
                this.compilationSettings.exec = true;
            }
        }, 'e');

        opts.flag('parse', {
            usage: 'Parse only',
            set: () => {
                this.compilationSettings.parseOnly = true;
            }
        });
        
        opts.flag('minw', {
            usage: 'Minimize whitespace',
            experimental: true,
            set: () => { this.compilationSettings.minWhitespace = true; }
        }, 'mw');

        opts.flag('const', {
            usage: 'Propagate constants to emitted code',
            experimental: true,
            set: () => { this.compilationSettings.propagateConstants = true; }
        });

        opts.flag('errorrecovery', {
            usage: 'Enable error recovery',
            set: () => {
                this.compilationSettings.errorRecovery = true;
            }
        }, 'er');

        opts.flag('comments', {
            usage: 'Emit comments to output',
            set: () => {
                this.compilationSettings.emitComments = true;
            }
        }, 'c');

        opts.flag('cflow', {
            usage: 'Control flow',
            experimental: true,
            set: () => {
                this.compilationSettings.controlFlow = true;
            }
        });

        opts.flag('cflowp', {
            usage: 'Print control flow',
            experimental: true,
            set: () => {
                this.compilationSettings.controlFlow = true;
                this.compilationSettings.printControlFlow = true;
            }
        });

        opts.flag('cflowu', {
            usage: 'Print Use Def control flow',
            experimental: true,
            set: () => {
                this.compilationSettings.controlFlow = true;
                this.compilationSettings.controlFlowUseDef = true;
            }
        });

        opts.flag('noerroronwith', {
            usage: 'Allow with statements',
            set: () => {
                this.compilationSettings.errorOnWith = false;
            }
        });

        opts.flag('noresolve', {
            usage: 'Skip resolution and preprocessing',
            set: () => {
                this.compilationSettings.resolve = false;
                this.compilationSettings.preprocess = false;
            }
        });

        opts.flag('debug', {
            usage: 'Print debug output',
            experimental: true,
            set: () => {
                TypeScript.CompilerDiagnostics.debug = true;
            }
        });

        opts.flag('canCallDefinitionSignature', {
            usage: 'Allows you to call the definition signature of an overload group',
            experimental: true,
            set: () => {
                this.compilationSettings.canCallDefinitionSignature = true;
            }
        });

        opts.flag('nooptimizemodules', {
            usage: 'Do not optimize module codegen',
            set: () => {
                TypeScript.optimizeModuleCodeGen = false;
            }
        });

        opts.flag('nolib', {
            usage: 'Do not include a default lib.d.ts with global declarations',
            set: () => {
                this.compilationSettings.useDefaultLib = false;
            }
        });


        opts.flag('inferProperties', {
            usage: 'Infer ES6 class properties from top-level assignments to \'this\'',
            experimental: true,
            set: () => {
                this.compilationSettings.inferPropertiesFromThisAssignment = true;
            }
        });

        opts.option('target', {
            usage: 'Specify ES version target. "ES3", "ES5", and "ES6" are supported.',
            type: 'module',
            set: (type) => {
                type = type.toLowerCase();

                if (type === 'es3') {
                    TypeScript.codeGenTarget = TypeScript.CodeGenTarget.ES3;
                } else if (type === 'es5') {
                    TypeScript.codeGenTarget = TypeScript.CodeGenTarget.ES5;
                } else if (type === 'es6') {
                    TypeScript.codeGenTarget = TypeScript.CodeGenTarget.ES6;
                } else {
                    this.ioHost.printLine("Unknown codegen target - using default ES3 mode");
                }
            }
        });

        opts.option('module', {
            usage: 'Specify module codegen. "Node", "Amd", and "Local" are supported.',
            type: 'module',
            set: (type) => {
                type = type.toLowerCase();

                if (type === 'node') {
                    TypeScript.moduleGenTarget = TypeScript.ModuleGenTarget.Synchronous;
                } else if (type === 'amd') {
                    TypeScript.moduleGenTarget = TypeScript.ModuleGenTarget.Asynchronous;
                } else if (type === 'local') {
                    TypeScript.moduleGenTarget = TypeScript.ModuleGenTarget.Local;
                } else {
                    this.ioHost.printLine("Unknown module");
                }
            }
        });

        opts.flag('help', {
            usage: 'Print this message',
            set: (type) => {
                opts.printUsage();
            }
        }, 'h');

        opts.flag('useCaseSensitiveFileName', {
            usage: 'Use Case-Sensitive operations on file names.',
            experimental: true,
            set: () => {
                this.compilationSettings.useCaseSensitiveFileResolution = true;
            }
        });

        opts.parse(this.ioHost.arguments);

        if (this.compilationSettings.useDefaultLib) {
            var compilerFilePath = this.ioHost.getExecutingFilePath()
            var binDirPath = this.ioHost.dirName(compilerFilePath);
            var libStrPath = this.ioHost.resolvePath(binDirPath + "\\lib.d.ts");
            code = new TypeScript.SourceUnit(libStrPath, null);
            this.compilationEnvironment.code.push(code);
        }

        for (var i = 0; i < opts.unnamed.length; i++) {
            code = new TypeScript.SourceUnit(opts.unnamed[i], null);
            this.compilationEnvironment.code.push(code);
        }

        // If no source files provided to compiler - print usage information
        if (this.compilationEnvironment.code.length == (this.compilationSettings.useDefaultLib ? 1 : 0) && this.compilationEnvironment.residentCode.length == 0) {
            opts.printUsage();
            return;
        }

        // resolve file dependencies, if requested
        this.resolvedEnvironment = this.compilationSettings.resolve ? this.resolve() : this.compilationEnvironment;

        // REVIEW: Update to use compilation settings / env
        if (this.compilationSettings.watch) {
            var files: string[] = []
            for (var iResCode = 0 ; iResCode < this.resolvedEnvironment.residentCode.length; iResCode++) {
                files.push(this.resolvedEnvironment.residentCode[iResCode].path);
            }
            for (var iCode = 0 ; iCode < this.resolvedEnvironment.code.length; iCode++) {
                files.push(this.resolvedEnvironment.code[iCode].path);
            }
            var canWatch = this.ioHost.watchFiles(files, () => {
                this.ioHost.printLine("Recompiling(" + new Date() + "): " + files);
                
                this.compilationEnvironment.code = [];
                for (var i = 0; i < opts.unnamed.length; i++) {
                    code = new TypeScript.SourceUnit(opts.unnamed[i], null);
                    this.compilationEnvironment.code.push(code);
                }

                // resolve file dependencies, if requested
                this.resolvedEnvironment = this.compilationSettings.resolve ? this.resolve() : this.compilationEnvironment;
                
                this.compile();
                if(this.compilationSettings.exec) {
                    this.run();
                }
                this.ioHost.printLine("");
            });
            if (!canWatch) {
                this.ioHost.printLine("Error: Current host does not support -w[atch] option");
            }
        } else {
            this.compile();
            if (this.compilationSettings.exec) {
                this.run();
            }
        }

    }
}

// Start the batch compilation using the current hosts IO
var batch = new BatchCompiler(IO);
batch.batchCompile();