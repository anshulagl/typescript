class Greeter {
    greeting: string;
    private boom : number;
    constructor(message: string) {
        this.greeting = message;
    }
    greet() {
    	this.bar();   
        return "Hello, " + this.greeting + this.boom;
    }
    private bar() {
    	return "We are done";
    }
    private blue = function(){
		return "hey dude";
    }
  }
var greeter = new Greeter("world");
greeter.greet();
var button = document.createElement('button');
button.innerText = "Say Hello";
button.onclick = function() {
    alert(greeter.greet());
}

document.body.appendChild(button);
