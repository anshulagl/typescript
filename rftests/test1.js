var Greeter = (function () {
     function Greeter(message) {
        this.__blue =  function () {
            return "hey dude";
        };
        this.greeting = message;
    }
    Greeter.prototype.greet =  function () {
        this.bar();
        return "Hello, " + this.greeting + this.boom;
    };
    Greeter.prototype.__bar =  function () {
        return "We are done";
    };
    return Greeter;
})();
var greeter = new Greeter("world");
greeter.greet();
var button = document.createElement('button');
button.innerText = "Say Hello";
button.onclick =  function () {
    alert(greeter.greet());
};
document.body.appendChild(button);
